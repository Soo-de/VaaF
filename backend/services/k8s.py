"""
services/k8s.py — Kubernetes & Knative Helper Functions
======================================================
Thin wrappers around kubectl CLI commands.
All interactions with Kubernetes, Knative, and ConfigMaps go through this module.
"""

import json
import subprocess
from typing import Optional

from config import (
    DEPARTMENT_NAMESPACE_MAP,
    MAX_REVISIONS_RETAINED,
    TENANT_NAMESPACE,
    logger,
)


def resolve_namespace(department: Optional[str] = None) -> str:
    """Resolve the target Kubernetes namespace for a given department.
    Falls back to TENANT_NAMESPACE if department is unmapped or omitted.
    """
    if not department:
        return TENANT_NAMESPACE
    normalized = department.lower().strip()
    return DEPARTMENT_NAMESPACE_MAP.get(normalized, TENANT_NAMESPACE)


def normalize_user_id(user_id: Optional[str]) -> Optional[str]:
    """Normalize user identity. Treats empty, 'anonymous', or 'default' as unscoped (None)."""
    if not user_id or user_id.lower().strip() in {"anonymous", "default", "none", ""}:
        return None
    return user_id.lower().strip()


def resolve_service_name(name: str, user_id: Optional[str] = None) -> str:
    """Resolve internal Kubernetes Service name scoped by user identity."""
    norm_user = normalize_user_id(user_id)
    return f"{norm_user}-{name}" if norm_user else name


def kubectl(*args: str, timeout: int = 30) -> subprocess.CompletedProcess:
    """Execute a raw kubectl command with arguments."""
    cmd = ["kubectl", *args]
    logger.debug("kubectl: %s", " ".join(cmd))
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


# ── ConfigMap Management ───────────────────────────────────────────────────────


def apply_configmap(
    name: str,
    data: dict[str, str],
    namespace: str = TENANT_NAMESPACE,
    labels: Optional[dict[str, str]] = None,
    timeout: int = 30,
) -> subprocess.CompletedProcess:
    """Create or update a ConfigMap by piping JSON via stdin to kubectl apply."""
    manifest = {
        "apiVersion": "v1",
        "kind": "ConfigMap",
        "metadata": {
            "name": name,
            "namespace": namespace,
            "labels": labels or {},
        },
        "data": data,
    }
    logger.debug(
        "kubectl apply -f - (ConfigMap/%s, keys=%s)", name, list(data.keys())
    )
    return subprocess.run(
        ["kubectl", "apply", "-f", "-"],
        input=json.dumps(manifest),
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def get_configmap_data(
    name: str, namespace: str = TENANT_NAMESPACE, timeout: int = 15
) -> Optional[dict[str, str]]:
    """Retrieve the data payload of a ConfigMap."""
    result = kubectl(
        "get", "configmap", name, "-n", namespace, "-o", "json", timeout=timeout
    )
    if result.returncode != 0:
        return None
    try:
        data = json.loads(result.stdout)
        return data.get("data", {})
    except json.JSONDecodeError:
        return None


def delete_configmap(
    name: str, namespace: str = TENANT_NAMESPACE, timeout: int = 30
) -> subprocess.CompletedProcess:
    """Delete a ConfigMap if it exists."""
    return kubectl(
        "delete",
        "configmap",
        name,
        "-n",
        namespace,
        "--ignore-not-found=true",
        timeout=timeout,
    )


# ── Knative Service Management ─────────────────────────────────────────────────


def apply_knative_service(
    manifest: dict, timeout: int = 30
) -> subprocess.CompletedProcess:
    """Apply a Knative Service manifest by piping JSON via stdin."""
    service_name = manifest.get("metadata", {}).get("name", "unknown")
    logger.debug("kubectl apply -f - (Knative Service/%s)", service_name)
    return subprocess.run(
        ["kubectl", "apply", "-f", "-"],
        input=json.dumps(manifest),
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def get_ksvc_ready_url(
    name: str, namespace: str = TENANT_NAMESPACE
) -> Optional[str]:
    """Return the function URL once the Knative Service status is Ready=True."""
    result = kubectl(
        "get",
        "ksvc",
        name,
        "-n",
        namespace,
        "-o",
        "jsonpath={.status.conditions[?(@.type=='Ready')].status} {.status.url}",
    )
    parts = result.stdout.split()
    return parts[1] if len(parts) == 2 and parts[0] == "True" else None


def list_ksvc(
    namespace: str = TENANT_NAMESPACE, user_id: Optional[str] = None
) -> list[dict]:
    """List all Knative Services in the namespace, optionally filtered by user ID."""
    norm_user = normalize_user_id(user_id)
    args = ["get", "ksvc", "-n", namespace]
    if norm_user:
        args.extend(["-l", f"faas.platform/user={norm_user}"])
    args.extend(["-o", "json"])

    result = kubectl(*args, timeout=20)
    if result.returncode != 0:
        return []

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []

    services = []
    for item in data.get("items", []):
        meta = item.get("metadata", {})
        labels = meta.get("labels", {})
        status = item.get("status", {})
        conditions = status.get("conditions", [])

        ready = next(
            (
                c["status"] == "True"
                for c in conditions
                if c.get("type") == "Ready"
            ),
            False,
        )

        display_name = labels.get("faas.platform/display-name") or meta.get(
            "name", ""
        )

        services.append(
            {
                "name": display_name,
                "service_name": meta.get("name", ""),
                "url": status.get("url", ""),
                "ready": ready,
                "created_at": meta.get("creationTimestamp", ""),
                "runtime": "python",
                "namespace": namespace,
                "user_id": labels.get("faas.platform/user", "default"),
            }
        )
    return services


def service_exists(
    name: str,
    namespace: str = TENANT_NAMESPACE,
    user_id: Optional[str] = None,
) -> bool:
    """Check if a function with the given name already exists for the user."""
    return any(f.get("name") == name for f in list_ksvc(namespace, user_id))


def delete_ksvc(
    name: str, namespace: str = TENANT_NAMESPACE, timeout: int = 30
) -> subprocess.CompletedProcess:
    """Delete a Knative Service and its associated resources."""
    return kubectl(
        "delete",
        "ksvc",
        name,
        "-n",
        namespace,
        "--ignore-not-found=true",
        timeout=timeout,
    )


# ── Revisions & Traffic Management ─────────────────────────────────────────────


def get_revisions(name: str, namespace: str = TENANT_NAMESPACE) -> list[dict]:
    """Return all Knative Revisions for a function, ordered newest first."""
    ksvc_result = kubectl(
        "get", "ksvc", name, "-n", namespace, "-o", "json", timeout=15
    )
    current_traffic_revision = ""
    if ksvc_result.returncode == 0:
        try:
            ksvc_data = json.loads(ksvc_result.stdout)
            traffic = ksvc_data.get("status", {}).get("traffic", [])
            for t in traffic:
                if t.get("percent", 0) == 100:
                    current_traffic_revision = t.get("revisionName", "")
                    break
        except Exception:
            pass

    result = kubectl(
        "get",
        "revisions",
        "-n",
        namespace,
        "-l",
        f"serving.knative.dev/service={name}",
        "-o",
        "json",
        "--sort-by=.metadata.creationTimestamp",
        timeout=20,
    )
    if result.returncode != 0:
        return []

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []

    revisions = []
    for item in reversed(data.get("items", [])):
        meta = item.get("metadata", {})
        rev_name = meta.get("name", "")
        revisions.append(
            {
                "name": rev_name,
                "created_at": meta.get("creationTimestamp", ""),
                "is_active": rev_name == current_traffic_revision,
                "has_code": True,
            }
        )
    return revisions


def rollback_to_revision(
    service_name: str, revision_name: str, namespace: str = TENANT_NAMESPACE
) -> tuple[bool, str]:
    """Route 100% of traffic to a specific historical revision."""
    patch = json.dumps(
        {
            "spec": {
                "traffic": [
                    {
                        "revisionName": revision_name,
                        "percent": 100,
                        "latestRevision": False,
                    }
                ]
            }
        }
    )
    result = kubectl(
        "patch",
        "ksvc",
        service_name,
        "-n",
        namespace,
        "--type=merge",
        "-p",
        patch,
        timeout=30,
    )
    if result.returncode == 0:
        return True, f"Traffic successfully switched to revision '{revision_name}'."
    return False, result.stderr.strip()[:300]


def prune_old_configmaps(
    function_name: str,
    max_retained: int = MAX_REVISIONS_RETAINED,
    namespace: str = TENANT_NAMESPACE,
) -> None:
    """Delete older versioned ConfigMaps for a function exceeding max_retained limit."""
    result = kubectl(
        "get",
        "configmaps",
        "-n",
        namespace,
        "-l",
        f"faas.platform/function={function_name}",
        "-o",
        "json",
        "--sort-by=.metadata.creationTimestamp",
        timeout=15,
    )
    if result.returncode != 0:
        return

    try:
        items = json.loads(result.stdout).get("items", [])
        if len(items) > max_retained:
            excess = len(items) - max_retained
            for cm in items[:excess]:
                cm_name = cm.get("metadata", {}).get("name", "")
                if cm_name:
                    logger.info("Pruning old ConfigMap: %s", cm_name)
                    delete_configmap(cm_name, namespace)
    except Exception as e:
        logger.warning(
            "Failed to prune old ConfigMaps for %s: %s", function_name, e
        )
