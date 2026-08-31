"""
config.py — Centralised configuration and language definitions
==============================================================
All environment-variable reads and static lookup tables live here.
Import from this module everywhere; never read os.getenv() outside it.
"""

import logging
import os
from pathlib import Path


# ── Logging ───────────────────────────────────────────────────────────────────

_LOG_LEVEL_NAME = os.getenv("LOG_LEVEL", "info").upper()
_POD_NAME = os.getenv("POD_NAME", "").replace("%", "%%")
_POD_PREFIX = f"[{_POD_NAME}] " if _POD_NAME else ""

logging.basicConfig(
    level=getattr(logging, _LOG_LEVEL_NAME, logging.INFO),
    format=f"%(asctime)s [%(levelname)s] {_POD_PREFIX}%(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("faas-platform")

# ── Runtime configuration (overridable via env / ConfigMap) ───────────────────

# !!! REVIEW AGAIN, WHEN IMAGE BUILD STEP IS REMOVED THESE ARE NOT NEEDED!!!
REGISTRY_PREFIX: str = os.getenv("REGISTRY_PREFIX", "docker.io/soodee")
TENANT_NAMESPACE: str = os.getenv("TENANT_NAMESPACE", "tenant-functions")
WORKSPACE_BASE: Path = Path(os.getenv("WORKSPACE_BASE", "/tmp/faas-workspace"))
DEPLOY_TIMEOUT: int = int(os.getenv("DEPLOY_TIMEOUT_SECONDS", "600"))  # 10 min
POLL_INTERVAL: int = 5  # seconds between ksvc readiness polls

REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
JOB_TTL_SECONDS: int = int(os.getenv("JOB_TTL_SECONDS", str(24 * 60 * 60)))  # 24h
