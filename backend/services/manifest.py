"""
services/manifest.py — Kubernetes & Knative Manifest Builders
============================================================
Pure functions for generating declarative Kubernetes ConfigMap and
Knative Service manifests for Serverless function deployments.
"""

from typing import Any, Dict

from config import (
    BASE_RUNTIME_IMAGE,
    DEFAULT_CPU_LIMIT,
    DEFAULT_CPU_REQUEST,
    DEFAULT_MEMORY_LIMIT,
    DEFAULT_MEMORY_REQUEST,
)
from models import DeployRequest, to_cm_key


def build_configmap_manifest(
    function_name: str,
    files: dict[str, str],
    configmap_name: str,
    target_namespace: str,
    active_user: str,
    job_id: str,
) -> Dict[str, Any]:
    """Pure function: Generates a Kubernetes ConfigMap manifest containing user code files.

    File paths are encoded as ConfigMap-safe keys using '__' as the path separator.
    Example: 'utils/database.py' becomes 'utils__database.py' in ConfigMap data.
    """
    cm_data = {
        to_cm_key(path): content
        for path, content in files.items()
    }

    return {
        "apiVersion": "v1",
        "kind": "ConfigMap",
        "metadata": {
            "name": configmap_name,
            "namespace": target_namespace,
            "labels": {
                "faas.platform/function": function_name,
                "faas.platform/display-name": function_name,
                "faas.platform/user": active_user,
                "faas.platform/deploy-id": job_id,
                "faas.platform/managed-by": "vaaf-platform",
            },
        },
        "data": cm_data,
    }


def _build_volume_items(files: dict[str, str]) -> list[Dict[str, str]]:
    """Build ConfigMap volume items list for hierarchical path mounting."""
    return [
        {"key": to_cm_key(path), "path": path}
        for path in files.keys()
    ]


def build_knative_service_manifest(
    req: DeployRequest,
    k8s_svc_name: str,
    configmap_name: str,
    target_namespace: str,
    active_user: str,
    job_id: str,
) -> Dict[str, Any]:
    """Pure function: Generates a fully validated Knative Service manifest dictionary."""
    env_vars = [
        {"name": "FUNCTION_NAME", "value": req.name},
        {"name": "HANDLER_PATH", "value": "/var/task/handler.py"},
        {"name": "DEPLOY_ID", "value": job_id},
    ]
    if req.environment:
        for env_k, env_v in req.environment.items():
            env_vars.append({"name": env_k, "value": str(env_v)})

    volume_items = _build_volume_items(req.files)

    return {
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
            "traffic": [
                {
                    "latestRevision": True,
                    "percent": 100,
                }
            ],
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
                    "timeoutSeconds": 60,
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
                                "items": volume_items,
                            },
                        }
                    ],
                },
            },
        },
    }
