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
    get_ksvc_failure_reason,
    get_ksvc_ready_url,
    kubectl,
    prune_old_configmaps,
    resolve_namespace,
    resolve_service_name,
)
from services.manifest import (
    build_configmap_manifest,
    build_knative_service_manifest,
)
from services.sse import sse_event
from services.validator import validate_python_code


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
        "[%s] Starting deploy: name='%s' k8s_svc='%s' ns='%s' user='%s' files=%d",
        job_id,
        req.name,
        k8s_svc_name,
        target_namespace,
        active_user,
        len(req.files),
    )

    try:
        # ── Code Syntax & Handler Signature Validation ───────────
        handler_code = req.files.get("handler.py", "")
        is_valid, val_err = validate_python_code(handler_code)
        if not is_valid:
            logger.warning("[%s] Pre-flight validation rejected '%s': %s", job_id, req.name, val_err)
            yield sse_event("error", val_err)
            yield sse_event("done", json.dumps({"status": "error", "detail": val_err}, ensure_ascii=False))
            await set_job(job_id, {"status": "failed", "error": val_err})
            return

        # ── STEP 1: Create Versioned ConfigMap for User Code ──────────────────
        yield sse_event("step", "📦 Step 1/3 — Saving function code to cluster...")

        cm_manifest = build_configmap_manifest(
            function_name=req.name,
            files=req.files,
            configmap_name=configmap_name,
            target_namespace=target_namespace,
            active_user=active_user,
            job_id=job_id,
        )

        cm_res = apply_configmap(
            name=configmap_name,
            data=cm_manifest["data"],
            namespace=target_namespace,
            labels=cm_manifest["metadata"]["labels"],
        )

        if cm_res.returncode != 0:
            error_msg = f"Failed to create ConfigMap: {cm_res.stderr.strip()}"
            logger.error("[%s] %s", job_id, error_msg)
            yield sse_event("error", error_msg)
            yield sse_event("done", json.dumps({"status": "error", "detail": error_msg}, ensure_ascii=False))
            await set_job(job_id, {"status": "failed", "error": error_msg})
            return

        total_bytes = sum(len(c.encode("utf-8")) for c in req.files.values())
        file_count = len(req.files)
        yield sse_event(
            "log",
            f"   → Stored {file_count} file(s) ({total_bytes} bytes) in ConfigMap '{configmap_name}'"
        )

        # ── STEP 2: Generate & Apply Knative Service Manifest ─────────────────
        yield sse_event("step", "🚀 Step 2/3 — Applying Knative Service manifest...")

        if req.environment:
            yield sse_event("log", f"   → Injected {len(req.environment)} custom environment variables")

        ksvc_manifest = build_knative_service_manifest(
            req=req,
            k8s_svc_name=k8s_svc_name,
            configmap_name=configmap_name,
            target_namespace=target_namespace,
            active_user=active_user,
            job_id=job_id,
        )

        ksvc_res = apply_knative_service(ksvc_manifest)
        if ksvc_res.returncode != 0:
            error_msg = f"Failed to apply Knative Service: {ksvc_res.stderr.strip()}"
            logger.error("[%s] %s", job_id, error_msg)
            yield sse_event("error", error_msg)
            yield sse_event("done", json.dumps({"status": "error", "detail": error_msg}, ensure_ascii=False))
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

            # Fast-Fail: detect container crash/failure immediately (in 2-3s)
            failure_reason = get_ksvc_failure_reason(k8s_svc_name, target_namespace)
            if failure_reason:
                error_msg = f"Function container failed to start:\n{failure_reason}"
                logger.error("[%s] Fast-fail for '%s': %s", job_id, req.name, failure_reason)
                yield sse_event("error", error_msg)
                yield sse_event("done", json.dumps({"status": "error", "detail": error_msg}, ensure_ascii=False))
                await set_job(job_id, {"status": "failed", "error": error_msg})
                return

            # Send periodic heartbeat log every 3 polls
            if attempt % 3 == 0:
                elapsed = int(time.time() - start_time)
                yield sse_event("log", f"   → Initializing pods in cluster... ({elapsed}s)")

            await asyncio.sleep(POLL_INTERVAL)

        # ── Finalization & Result ─────────────────────────────────────────────
        total_duration = round(time.time() - start_time, 2)

        if not function_url:
            # 1. First priority: Extract exact runtime error from Knative Revision status condition
            rev_probe = kubectl(
                "get",
                "revision",
                "-n",
                target_namespace,
                "-l",
                f"serving.knative.dev/service={k8s_svc_name}",
                "--sort-by=.metadata.creationTimestamp",
                "-o",
                "jsonpath={.items[-1].status.conditions[?(@.type=='Ready')].message}",
                timeout=10,
            )
            detail_err = rev_probe.stdout.strip()

            # 2. Second priority: Container pod logs
            if not detail_err:
                logs_probe = kubectl(
                    "logs",
                    "-n",
                    target_namespace,
                    "-l",
                    f"serving.knative.dev/service={k8s_svc_name}",
                    "-c",
                    "user-container",
                    "--tail=10",
                    timeout=10,
                )
                detail_err = logs_probe.stdout.strip()

            # 3. Fallback: Generic Kubernetes cluster events
            if not detail_err:
                events_probe = kubectl(
                    "get",
                    "events",
                    "-n",
                    target_namespace,
                    "--sort-by=.metadata.creationTimestamp",
                    "-o",
                    "jsonpath={.items[-1].message}",
                    timeout=10,
                )
                detail_err = events_probe.stdout.strip() or "Readiness check timed out."

            error_msg = f"Function readiness timeout after {DEPLOY_TIMEOUT}s: {detail_err}"

            logger.error("[%s] Deploy timeout for '%s': %s", job_id, req.name, detail_err)
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
