"""
routers/functions.py — Function management, code inspection, revisions & rollback
=================================================================================
Handles CRUD operations for serverless functions, revision history lookups,
instant traffic rollback, and code retrieval from versioned ConfigMaps.
Supports department-based namespace routing and user-scoped resource isolation.
"""

import asyncio
import json
import re
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from config import logger
from models import DeleteResponse
from services.k8s import (
    delete_ksvc,
    get_configmap_data,
    get_revisions,
    kubectl,
    list_ksvc,
    resolve_namespace,
    resolve_service_name,
    rollback_to_revision,
)

router = APIRouter(tags=["functions"])

_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{2,49}$")


def _validate_name(name: str) -> None:
    if not _NAME_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail="Invalid function name. Must start with a lowercase letter and contain only lowercase letters, digits, and hyphens.",
        )


class RollbackRequest(BaseModel):
    revision_name: str = Field(..., min_length=3, max_length=100)


# ── 1. List Functions ──────────────────────────────────────────────────────────


@router.get("/functions", summary="List all deployed functions")
async def get_functions(
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    x_department: Optional[str] = Header(None, alias="X-Department"),
):
    """List functions in the target department namespace, optionally scoped by user."""
    target_namespace = resolve_namespace(x_department)

    probe = await asyncio.to_thread(
        kubectl, "get", "namespace", target_namespace, "--no-headers", timeout=10
    )
    if probe.returncode != 0:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot reach cluster or namespace '{target_namespace}' is unavailable.",
        )

    functions = await asyncio.to_thread(list_ksvc, target_namespace, x_user_id)
    return {"functions": functions, "namespace": target_namespace}


# ── 2. Get Function Code & Environment ────────────────────────────────────────


@router.get("/functions/{name}/code", summary="Get active function source code and env vars")
async def get_function_code(
    name: str,
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    x_department: Optional[str] = Header(None, alias="X-Department"),
):
    """Retrieve source code and environment variables from the active ConfigMap."""
    _validate_name(name)
    target_namespace = resolve_namespace(x_department)
    k8s_svc_name = resolve_service_name(name, x_user_id)

    # 1. Fetch Knative Service JSON
    result = await asyncio.to_thread(
        kubectl, "get", "ksvc", k8s_svc_name, "-n", target_namespace, "-o", "json", timeout=15
    )
    if result.returncode != 0:
        raise HTTPException(
            status_code=404, detail=f"Function '{name}' not found in cluster."
        )

    try:
        ksvc = json.loads(result.stdout)
        spec = ksvc.get("spec", {}).get("template", {}).get("spec", {})

        # 2. Extract mounted ConfigMap name
        configmap_name = None
        for vol in spec.get("volumes", []):
            if vol.get("name") == "user-code":
                configmap_name = vol.get("configMap", {}).get("name")
                break

        if not configmap_name:
            raise HTTPException(
                status_code=404, detail=f"No user-code volume found for function '{name}'."
            )

        # 3. Read code from ConfigMap
        cm_data = await asyncio.to_thread(
            get_configmap_data, configmap_name, target_namespace
        )
        if not cm_data or "handler.py" not in cm_data:
            raise HTTPException(
                status_code=404, detail=f"Source code missing in ConfigMap '{configmap_name}'."
            )

        # 4. Extract custom environment variables (filter out platform internals)
        platform_keys = {"FUNCTION_NAME", "HANDLER_PATH", "DEPLOY_ID", "PORT"}
        custom_env = {}
        containers = spec.get("containers", [])
        if containers:
            for env_item in containers[0].get("env", []):
                env_k = env_item.get("name")
                env_v = env_item.get("value")
                if env_k and env_k not in platform_keys:
                    custom_env[env_k] = env_v

        return {
            "name": name,
            "language": "python",
            "code": cm_data["handler.py"],
            "environment": custom_env,
            "configmap": configmap_name,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error loading function code for '%s'", name)
        raise HTTPException(status_code=500, detail=f"Failed to inspect function code: {str(e)}")


# ── 3. List Function Revisions ─────────────────────────────────────────────────


@router.get("/functions/{name}/revisions", summary="Get revision history for a function")
async def get_function_revisions(
    name: str,
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    x_department: Optional[str] = Header(None, alias="X-Department"),
):
    """Return all historical revisions for a function, ordered newest first."""
    _validate_name(name)
    target_namespace = resolve_namespace(x_department)
    k8s_svc_name = resolve_service_name(name, x_user_id)

    revisions = await asyncio.to_thread(get_revisions, k8s_svc_name, target_namespace)
    return {"function_name": name, "revisions": revisions}


# ── 4. Get Code for Specific Revision ─────────────────────────────────────────


@router.get(
    "/functions/{name}/revision/{revision_name}/code",
    summary="Get source code for a specific historical revision",
)
async def get_revision_code(
    name: str,
    revision_name: str,
    x_department: Optional[str] = Header(None, alias="X-Department"),
):
    """Retrieve code that was deployed in a specific historical revision."""
    _validate_name(name)
    target_namespace = resolve_namespace(x_department)

    result = await asyncio.to_thread(
        kubectl, "get", "revision", revision_name, "-n", target_namespace, "-o", "json", timeout=15
    )
    if result.returncode != 0:
        raise HTTPException(
            status_code=404, detail=f"Revision '{revision_name}' not found."
        )

    try:
        rev_data = json.loads(result.stdout)
        spec = rev_data.get("spec", {})

        configmap_name = None
        for vol in spec.get("volumes", []):
            if vol.get("name") == "user-code":
                configmap_name = vol.get("configMap", {}).get("name")
                break

        if not configmap_name:
            raise HTTPException(
                status_code=404, detail=f"No user-code volume found in revision '{revision_name}'."
            )

        cm_data = await asyncio.to_thread(
            get_configmap_data, configmap_name, target_namespace
        )
        if not cm_data or "handler.py" not in cm_data:
            raise HTTPException(
                status_code=404, detail=f"Source code missing in ConfigMap '{configmap_name}'."
            )

        return {
            "name": name,
            "revision_name": revision_name,
            "language": "python",
            "code": cm_data["handler.py"],
            "configmap": configmap_name,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error loading revision code for '%s' (%s)", name, revision_name)
        raise HTTPException(status_code=500, detail=f"Failed to inspect revision code: {str(e)}")


# ── 5. Rollback to Revision ────────────────────────────────────────────────────


@router.post("/functions/{name}/rollback", summary="Rollback traffic to a historical revision")
async def rollback_function(
    name: str,
    req: RollbackRequest,
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    x_department: Optional[str] = Header(None, alias="X-Department"),
):
    """Route 100% of function traffic to a selected past revision."""
    _validate_name(name)
    target_namespace = resolve_namespace(x_department)
    k8s_svc_name = resolve_service_name(name, x_user_id)

    ok, message = await asyncio.to_thread(
        rollback_to_revision, k8s_svc_name, req.revision_name, target_namespace
    )
    if not ok:
        raise HTTPException(status_code=400, detail=f"Rollback failed: {message}")

    logger.info("Rollback successful for '%s' -> '%s'", k8s_svc_name, req.revision_name)
    return {"status": "ok", "message": message, "active_revision": req.revision_name}


# ── 6. Delete Function ────────────────────────────────────────────────────────


@router.delete("/functions/{name}", response_model=DeleteResponse, summary="Delete a function and its ConfigMaps")
async def delete_function(
    name: str,
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    x_department: Optional[str] = Header(None, alias="X-Department"),
):
    """Delete Knative Service and all versioned ConfigMaps for the function."""
    _validate_name(name)
    target_namespace = resolve_namespace(x_department)
    k8s_svc_name = resolve_service_name(name, x_user_id)

    # 1. Delete Knative Service
    del_ksvc = await asyncio.to_thread(delete_ksvc, k8s_svc_name, target_namespace)
    if del_ksvc.returncode != 0:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete Knative Service: {del_ksvc.stderr.strip()}"
        )

    # 2. Delete all historical ConfigMaps labeled for this function
    await asyncio.to_thread(
        kubectl,
        "delete",
        "configmap",
        "-n",
        target_namespace,
        "-l",
        f"faas.platform/function={name}",
        "--ignore-not-found=true",
        timeout=15,
    )

    logger.info("Deleted function '%s' and all associated ConfigMaps from '%s'", k8s_svc_name, target_namespace)
    return DeleteResponse(message=f"Function '{name}' deleted successfully.", function_name=name)
