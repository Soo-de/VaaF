"""
routers/deploy.py — Function deployment endpoint (SSE stream)
============================================================
Handles POST /deploy requests by initiating the asynchronous build-free
deployment pipeline and streaming real-time status frames to the client.
"""

import asyncio
import uuid
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from config import logger
from models import DeployRequest
from services.job_store import set_job
from services.k8s import resolve_namespace, service_exists
from services.pipeline import run_deploy_pipeline

router = APIRouter(tags=["deploy"])


@router.post("/deploy", summary="Deploy a serverless Python function (SSE stream)")
async def deploy_function(
    req: DeployRequest,
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    x_department: Optional[str] = Header(None, alias="X-Department"),
):
    """Initiate function deployment.

    Streams real-time step and log events via Server-Sent Events (SSE).
    """
    target_namespace = resolve_namespace(x_department)

    # Check existence scoped by user identity
    if not req.is_update:
        exists = await asyncio.to_thread(
            service_exists, req.name, target_namespace, x_user_id
        )
        if exists:
            raise HTTPException(
                status_code=409,
                detail=f"Function '{req.name}' already exists. Please choose a different name or use Update mode.",
            )

    job_id = str(uuid.uuid4())[:8]
    active_user = x_user_id or "anonymous"

    logger.info(
        "[%s] Deploy request: name='%s' ns='%s' is_update=%s user='%s'",
        job_id,
        req.name,
        target_namespace,
        req.is_update,
        active_user,
    )

    await set_job(
        job_id,
        {
            "status": "running",
            "function_name": req.name,
            "user_id": active_user,
            "namespace": target_namespace,
        },
    )

    return StreamingResponse(
        run_deploy_pipeline(
            job_id=job_id,
            req=req,
            user_id=x_user_id,
            department=x_department,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Job-ID": job_id,
        },
    )
