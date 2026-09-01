"""
services/health_check.py — Abstracted Platform Health Verifier
==============================================================
Verifies core platform dependencies:
1. Kubernetes Cluster API reachability
2. Knative Serving CRD readiness
3. In-cluster Redis connectivity
4. Target functions namespace existence

Internal error details are logged securely to stdout, never exposed in public API responses.
"""

import asyncio
from datetime import datetime, timezone
from typing import Tuple

import redis.asyncio as aioredis

from config import REDIS_URL, TENANT_NAMESPACE, logger
from services.k8s import kubectl


async def check_kubernetes_api() -> bool:
    """Verify the Kubernetes cluster is reachable."""
    result = await asyncio.to_thread(
        kubectl, "get", "namespace", TENANT_NAMESPACE, "--no-headers", timeout=5
    )
    return result.returncode == 0


async def check_knative_crd() -> bool:
    """Verify Knative Serving CRDs are installed and active."""
    result = await asyncio.to_thread(
        kubectl, "get", "crd", "services.serving.knative.dev", "--no-headers", timeout=5
    )
    return result.returncode == 0


async def check_redis_store() -> bool:
    """Verify Redis job store connectivity."""
    try:
        client = aioredis.from_url(REDIS_URL, socket_connect_timeout=3, socket_timeout=3)
        pong = await client.ping()
        await client.aclose()
        return bool(pong)
    except Exception as e:
        logger.warning("Health check: Redis ping failed: %s", e)
        return False


async def evaluate_system_health() -> Tuple[str, str]:
    """
    Run all core checks concurrently.
    Returns (status, timestamp) where status is 'healthy' or 'degraded'.
    """
    k8s_ok, knative_ok, redis_ok = await asyncio.gather(
        check_kubernetes_api(),
        check_knative_crd(),
        check_redis_store(),
        return_exceptions=True,
    )

    is_healthy = (k8s_ok is True) and (knative_ok is True) and (redis_ok is True)

    if not is_healthy:
        logger.warning(
            "System health degraded — K8s: %s, Knative: %s, Redis: %s",
            k8s_ok, knative_ok, redis_ok
        )

    current_timestamp = datetime.now(timezone.utc).isoformat()
    return ("healthy" if is_healthy else "degraded", current_timestamp)
