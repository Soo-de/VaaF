"""services/job_store.py — Shared deploy-job status store (Redis-backed)
==========================================================================
One Redis key per job (`faas:job:<id>`) so any orchestrator replica can read
a job written by another — this is what makes `replicas: 2` safe.

Writes are best-effort (a Redis hiccup must not report a successful deploy as
failed); reads let errors propagate, so an outage surfaces as a 503 rather
than a misleading 404.

NEVER put credentials/API keys in a job — GET /jobs/{id} is unauthenticated
and readable for JOB_TTL_SECONDS.
"""

import json
import redis.asyncio as redis
from config import JOB_TTL_SECONDS, REDIS_URL, logger

# for unique job ids
_KEY_PREFIX = "faas:job:"

# for singleton
_client: redis.Redis | None = None


def _get_client() -> redis.Redis:
    """Lazily create the shared async Redis client (module-level singleton).

    redis.from_url() doesn't open a connection by itself — the actual TCP
    connect happens on the first command — so importing this module (e.g.
    from tests that never deploy anything) never touches the network.
    """
    global _client
    if _client is None:
        _client = redis.from_url(REDIS_URL, decode_responses=True)
    return _client


async def set_job(job_id: str, data: dict) -> None:
    """Persist a job's status, expiring after JOB_TTL_SECONDS."""
    try:
        await _get_client().set(f"{_KEY_PREFIX}{job_id}", json.dumps(data), ex=JOB_TTL_SECONDS)
    except Exception:
        logger.exception("[%s] Failed to write job status to Redis (deploy result unaffected)"  , job_id)


async def get_job(job_id: str) -> dict | None:
    """Fetch a job's status, or None if it doesn't exist (or has expired)."""
    raw = await _get_client().get(f"{_KEY_PREFIX}{job_id}")
    return json.loads(raw) if raw is not None else None
