"""
services/pipeline.py — Build-Free Serverless Function Deployment Pipeline
========================================================================
Executes the 3-step zero-build deployment process:
1. Stores user code into a versioned Kubernetes ConfigMap.
2. Generates and applies the Knative Service manifest (injecting base image + env vars).
3. Polls Knative readiness state and yields SSE (Server-Sent Events) in real-time.
"""

import asyncio
import json
import time
from typing import AsyncGenerator, Optional

from config import (
    BASE_RUNTIME_IMAGE,
    DEFAULT_CPU_LIMIT,
    DEFAULT_CPU_REQUEST,
    DEFAULT_MEMORY_LIMIT,
    DEFAULT_MEMORY_REQUEST,
    DEPLOY_TIMEOUT,
    MAX_REVISIONS_RETAINED,
    POLL_INTERVAL,
    logger,
)
from models import DeployRequest
from services.job_store import set_job
from services.k8s import (
    apply_configmap,
    apply_knative_service,
    get_ksvc_ready_url,
    kubectl,
    prune_old_configmaps,
    resolve_namespace,
    resolve_service_name,
)
from services.sse import sse_event


async def run_deploy_pipeline(
    job_id: str,
    req: DeployRequest,
    user_id: Optional[str] = "default",
    department: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Execute function deployment as an asynchronous SSE stream."""
    start_time = time.time()
    active_user = user_id or "default"
    target_namespace = resolve_namespace(department)

    # Resolve Kubernetes service name using centralized normalization
    k8s_svc_name = resolve_service_name(req.name, user_id)
    configmap_name = f"fn-{k8s_svc_name}-{job_id}"

    logger.info(
        "[%s] Starting deploy: name='%s' k8s_svc='%s' ns='%s' user='%s'",
        job_id,
        req.name,
        k8s_svc_name,
        target_namespace,
        active_user,
    )

    try:
        # ── STEP 1: Create Versioned ConfigMap for User Code ──────────────────
        yield sse_event("step", "📦 Step 1/3 — Saving function code to cluster...")

        cm_data = {"handler.py": req.code}
        cm_labels = {
            "faas.platform/function": req.name,
            "faas.platform/display-name": req.name,
            "faas.platform/user": active_user,
            "faas.platform/deploy-id": job_id,
            "faas.platform/managed-by": "vaaf-platform",
        }

        cm_res = apply_configmap(
            name=configmap_name,
            data=cm_data,
            namespace=target_namespace,
            labels=cm_labels,
        )

        if cm_res.returncode != 0:
            error_msg = f"Failed to create ConfigMap: {cm_res.stderr.strip()}"
            logger.error("[%s] %s", job_id, error_msg)
            yield sse_event("error", error_msg)
            yield sse_event("done", json.dumps({"status": "error", "detail": error_msg}))
            await set_job(job_id, {"status": "failed", "error": error_msg})
            return

        code_size_bytes = len(req.code.encode("utf-8"))
        yield sse_event("log", f"   → Stored handler.py ({code_size_bytes} bytes) in ConfigMap '{configmap_name}'")

        # ── STEP 2: Generate & Apply Knative Service Manifest ─────────────────
        yield sse_event("step", "🚀 Step 2/3 — Applying Knative Service manifest...")

        # Convert user-provided environment dictionary into container EnvVar list
        env_vars = [
            {"name": "FUNCTION_NAME", "value": req.name},
            {"name": "HANDLER_PATH", "value": "/var/task/handler.py"},
            {"name": "DEPLOY_ID", "value": job_id},
        ]
        if req.environment:
            for env_k, env_v in req.environment.items():
                env_vars.append({"name": env_k, "value": str(env_v)})
            yield sse_event("log", f"   → Injected {len(req.environment)} custom environment variables")

        ksvc_manifest = {
            "apiVersion": "serving.knative.dev/v1",
            "kind": "Service",
            "metadata": {
                "name": k8s_svc_name,
                "namespace": target_namespace,
                "labels": {
                    "faas.platform/function": req.name,
                    "faas.platform/display-name": req.name,
                    "faas.platform/user": active_user,
                    "faas.platform/runtime": "python",
                    "faas.platform/managed-by": "vaaf-platform",
                },
            },
            "spec": {
                "template": {
                    "metadata": {
                        "annotations": {
                            "autoscaling.knative.dev/min-scale": "0",
                            "autoscaling.knative.dev/max-scale": "5",
                            "autoscaling.knative.dev/target": "10",
                            "faas.platform/deploy-id": job_id,
                        },
                    },
                    "spec": {
                        "containers": [
                            {
                                "name": "user-container",
                                "image": BASE_RUNTIME_IMAGE,
                                "imagePullPolicy": "IfNotPresent",
                                "ports": [{"containerPort": 8080}],
                                "env": env_vars,
                                "resources": {
                                    "requests": {
                                        "cpu": DEFAULT_CPU_REQUEST,
                                        "memory": DEFAULT_MEMORY_REQUEST,
                                    },
                                    "limits": {
                                        "cpu": DEFAULT_CPU_LIMIT,
                                        "memory": DEFAULT_MEMORY_LIMIT,
                                    },
                                },
                                "volumeMounts": [
                                    {
                                        "name": "user-code",
                                        "mountPath": "/var/task",
                                        "readOnly": True,
                                    }
                                ],
                            }
                        ],
                        "volumes": [
                            {
                                "name": "user-code",
                                "configMap": {
                                    "name": configmap_name,
                                },
                            }
                        ],
                    },
                }
            },
        }

        ksvc_res = apply_knative_service(ksvc_manifest)
        if ksvc_res.returncode != 0:
            error_msg = f"Failed to apply Knative Service: {ksvc_res.stderr.strip()}"
            logger.error("[%s] %s", job_id, error_msg)
            yield sse_event("error", error_msg)
            yield sse_event("done", json.dumps({"status": "error", "detail": error_msg}))
            await set_job(job_id, {"status": "failed", "error": error_msg})
            return

        yield sse_event("log", f"   → Knative Service applied in '{target_namespace}' using runtime: '{BASE_RUNTIME_IMAGE}'")

        # ── STEP 3: Poll for Service Ready Status ─────────────────────────────
        yield sse_event("step", "⏳ Step 3/3 — Waiting for function to become ready...")

        deadline = time.time() + DEPLOY_TIMEOUT
        function_url = None
        attempt = 0

        while time.time() < deadline:
            attempt += 1
            function_url = get_ksvc_ready_url(k8s_svc_name, target_namespace)
            if function_url:
                break

            # Send periodic heartbeat log every 3 polls
            if attempt % 3 == 0:
                elapsed = int(time.time() - start_time)
                yield sse_event("log", f"   → Initializing pods in cluster... ({elapsed}s)")

            await asyncio.sleep(POLL_INTERVAL)

        # ── Finalization & Result ─────────────────────────────────────────────
        total_duration = round(time.time() - start_time, 2)

        if not function_url:
            events_probe = kubectl(
                "get", "events", "-n", target_namespace,
                "--sort-by=.metadata.creationTimestamp",
                "-o", "jsonpath={.items[-1].message}",
                timeout=10,
            )
            detail_err = events_probe.stdout.strip() or "Readiness check timed out."
            error_msg = f"Function readiness timeout after {DEPLOY_TIMEOUT}s: {detail_err}"

            logger.error("[%s] Deploy timeout for '%s'", job_id, req.name)
            yield sse_event("error", error_msg)
            yield sse_event("done", json.dumps({"status": "error", "detail": error_msg}))
            await set_job(job_id, {"status": "failed", "error": error_msg})
            return

        # Success!
        logger.info("[%s] Function '%s' is LIVE at %s (%ss)", job_id, req.name, function_url, total_duration)

        yield sse_event("url", function_url)
        yield sse_event("step", f"✅ '{req.name}' is LIVE!")
        yield sse_event("log", f"   → Ready in {total_duration}s. Accessible at: {function_url}")

        result_payload = {
            "status": "success",
            "function_name": req.name,
            "url": function_url,
            "duration_seconds": total_duration,
            "revision_configmap": configmap_name,
        }

        yield sse_event("done", json.dumps(result_payload))
        await set_job(job_id, result_payload)

        # Non-blocking asynchronous cleanup: Prune old ConfigMaps in background thread
        asyncio.create_task(
            asyncio.to_thread(
                prune_old_configmaps, req.name, MAX_REVISIONS_RETAINED, target_namespace
            )
        )

    except Exception as e:
        logger.exception("[%s] Unexpected exception during deploy", job_id)
        err_text = f"Internal deploy error: {str(e)}"
        yield sse_event("error", err_text)
        yield sse_event("done", json.dumps({"status": "error", "detail": err_text}))
        await set_job(job_id, {"status": "failed", "error": err_text})
