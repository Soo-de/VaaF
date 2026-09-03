"""
config.py — Centralized configuration and environment definitions
==================================================================
All environment-variable reads and static lookup tables live here.
Import from this module everywhere; never call os.getenv() outside it.
"""

import logging
import os
from pathlib import Path

# ── Logging Configuration ──────────────────────────────────────────────────────

_LOG_LEVEL_NAME = os.getenv("LOG_LEVEL", "INFO").upper()
_POD_NAME = os.getenv("POD_NAME", "").replace("%", "%%")
_POD_PREFIX = f"[{_POD_NAME}] " if _POD_NAME else ""

logging.basicConfig(
    level=getattr(logging, _LOG_LEVEL_NAME, logging.INFO),
    format=f"%(asctime)s [%(levelname)s] {_POD_PREFIX}%(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("vaaf-platform")

# ── Runtime & Kubernetes Configuration ─────────────────────────────────────────

# In-cluster default namespace where functions and ConfigMaps are deployed
TENANT_NAMESPACE: str = os.getenv("TENANT_NAMESPACE", "vaaf-functions")

# Static mappings for predefined department namespaces
DEPARTMENT_NAMESPACE_MAP: dict[str, str] = {
    "ai": "vaaf-ai",
    "bigdata": "vaaf-bigdata",
    "core": "vaaf-core",
}

# Pre-baked base runtime image for all Python functions
BASE_RUNTIME_IMAGE: str = os.getenv(
    "BASE_RUNTIME_IMAGE", "docker.io/soodee/faas-python-runtime:latest"
)

# Registry prefix (kept for reference / compatibility)
REGISTRY_PREFIX: str = os.getenv("REGISTRY_PREFIX", "docker.io/soodee")

# Deploy timeout in seconds (60s for lightweight ConfigMap + Knative rollout)
DEPLOY_TIMEOUT: int = int(os.getenv("DEPLOY_TIMEOUT_SECONDS", "60"))

# Polling interval (seconds) while waiting for Knative Service ready state
POLL_INTERVAL: float = float(os.getenv("POLL_INTERVAL_SECONDS", "1.0"))

# Maximum historical revisions to retain per function (older ConfigMaps are pruned)
MAX_REVISIONS_RETAINED: int = int(os.getenv("MAX_REVISIONS_RETAINED", "10"))

# ── Default Resource Limits for Tenant Pods ────────────────────────────────────

DEFAULT_MEMORY_LIMIT: str = os.getenv("DEFAULT_MEMORY_LIMIT", "512Mi")
DEFAULT_CPU_LIMIT: str = os.getenv("DEFAULT_CPU_LIMIT", "500m")
DEFAULT_MEMORY_REQUEST: str = os.getenv("DEFAULT_MEMORY_REQUEST", "128Mi")
DEFAULT_CPU_REQUEST: str = os.getenv("DEFAULT_CPU_REQUEST", "100m")

# ── Redis & Job Store Configuration ────────────────────────────────────────────

REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
JOB_TTL_SECONDS: int = int(os.getenv("JOB_TTL_SECONDS", str(24 * 60 * 60)))  # 24h

# ── Security & Proxy Configuration ─────────────────────────────────────────────

# Allowed domain suffixes for /proxy test invocations (SSRF Protection)
ALLOWED_PROXY_DOMAINS: list[str] = [
    ".sslip.io",
    ".svc.cluster.local",
    "localhost",
    "127.0.0.1",
]

# ── Paths & Static Frontend ────────────────────────────────────────────────────

BACKEND_DIR: Path = Path(__file__).parent
FRONTEND_DIR: Path = Path(__file__).parent.parent / "frontend"

# ── Supported Runtimes (MVP: Python) ───────────────────────────────────────────

SUPPORTED_LANGUAGES: list[str] = ["python"]
