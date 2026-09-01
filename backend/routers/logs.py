"""
routers/logs.py — Real-time pod log retrieval for serverless functions
======================================================================
Fetches recent stdout/stderr log lines from active Knative pods.
Supports user and department scoping to retrieve logs from isolated namespaces.
"""

import asyncio
import re
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from services.k8s import kubectl, resolve_namespace, resolve_service_name

router = APIRouter(tags=["logs"])

_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{2,49}$")


@router.get("/logs/{name}", summary="Tail recent pod logs for a function")
async def get_logs(
    name: str,
    tail: int = 100,
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    x_department: Optional[str] = Header(None, alias="X-Department"),
):
    """Return the last N log lines from pods backing a Knative Service."""
    if not _NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid function name format.")

    target_namespace = resolve_namespace(x_department)
    k8s_svc_name = resolve_service_name(name, x_user_id)

    # Fetch logs asynchronously from Knative pods
    result = await asyncio.to_thread(
        kubectl,
        "logs",
        "-n",
        target_namespace,
        "-l",
        f"serving.knative.dev/service={k8s_svc_name}",
        "--prefix",
        f"--tail={tail}",
        timeout=15,
    )

    if result.returncode != 0:
        return {
            "function_name": name,
            "logs": [],
            "message": "No active pods (function may be scaled to zero). Invoke the function URL to trigger a cold start.",
        }

    lines = result.stdout.strip().split("\n") if result.stdout.strip() else []
    return {
        "function_name": name,
        "namespace": target_namespace,
        "lines": len(lines),
        "logs": lines,
    }
