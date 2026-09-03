# ============================================================
#  VaaF/backend/Dockerfile
#  Lightweight multi-stage build for VaaF Platform Orchestrator
#
#  Includes:
#  - Python 3.11 (slim)
#  - kubectl (for Knative & ConfigMap management)
#  - Non-root secure execution (UID 1001)
# ============================================================

# ── Stage 1: Python dependency builder ───────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build
COPY backend/requirements.txt .

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 2: Final runtime image ──────────────────────────────────────────────
FROM python:3.11-slim AS runtime

ARG TARGETARCH=amd64
ARG KUBECTL_VERSION=v1.30.0

# Install minimal system tools (curl for healthcheck and kubectl download)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install pinned kubectl binary
RUN curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" \
         -o /usr/local/bin/kubectl && \
    chmod +x /usr/local/bin/kubectl && \
    kubectl version --client

# Copy pre-installed Python packages from builder stage
COPY --from=builder /install /usr/local

# Copy application backend and frontend
WORKDIR /app
COPY backend/ ./backend/
COPY frontend/ ./frontend/
WORKDIR /app/backend

# Create and switch to non-root user for security
RUN useradd -m -u 1001 vaaf && \
    chown -R vaaf:vaaf /app
USER vaaf

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Runtime environment settings
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
