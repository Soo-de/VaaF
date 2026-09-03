"""
main.py — VaaF Platform: FastAPI Application Entry Point
========================================================
Lightweight application bootstrapper:
- Registers CORS middleware and static frontend assets
- Connects modular HTTP routers (deploy, functions, logs, health, jobs, proxy)
- Manages application lifespan and startup configurations
"""

import sys
import asyncio
from contextlib import asynccontextmanager

# Windows async subprocess event-loop fix
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import (
    BASE_RUNTIME_IMAGE,
    FRONTEND_DIR,
    TENANT_NAMESPACE,
    logger,
)
from routers import deploy, functions, health, jobs, logs, proxy, run


# ── Application Lifespan ──────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Bootstrap application settings on startup and handle graceful shutdown."""
    logger.info("========================================================")
    logger.info(" 🚀 VaaF Serverless Platform Orchestrator starting up")
    logger.info("    Base Runtime: %s", BASE_RUNTIME_IMAGE)
    logger.info("    Default Namespace: %s", TENANT_NAMESPACE)
    logger.info("========================================================")
    yield
    logger.info("Shutting down VaaF Platform Orchestrator.")


# ── FastAPI Application Instance ──────────────────────────────────────────────


app = FastAPI(
    title="VaaF Platform",
    description="Internal Developer Platform — Zero-Build Serverless Python Functions on Knative",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS Middleware ───────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Router Registrations ──────────────────────────────────────────────────────

app.include_router(health.router)
app.include_router(deploy.router)
app.include_router(functions.router)
app.include_router(logs.router)
app.include_router(jobs.router)
app.include_router(proxy.router)
app.include_router(run.router)

# ── Static Frontend Assets ────────────────────────────────────────────────────
# Mounted at root after API routers so /health, /deploy etc. take priority
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
