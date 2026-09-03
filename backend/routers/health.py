"""
routers/health.py — Health check endpoints for Kubernetes and UI status
========================================================================
1. GET /health: Ultra-fast probe for Kubernetes liveness/readiness.
2. GET /health/status: Abstracted system status for the frontend 'All Systems Operational' badge.
"""

from fastapi import APIRouter
from services.health_check import evaluate_system_health

router = APIRouter(tags=["health"])


@router.get("/health", summary="Kubernetes Liveness / Readiness Probe")
async def liveness_probe():
    """Instant 200 OK probe for Kubernetes container orchestrator."""
    return {"status": "ok"}


@router.get("/health/status", summary="Frontend System Health Badge")
async def system_status():
    """
    Returns high-level system status ('healthy' or 'degraded') and UTC timestamp.
    Abstracts all infrastructure internals from the client.
    """
    status, timestamp = await evaluate_system_health()
    return {
        "status": status,
        "timestamp": timestamp,
    }
