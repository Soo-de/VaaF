"""
routers/proxy.py — Proxies function invocation requests from the test tab to bypass browser CORS.
Restricts outgoing targets to ALLOWED_DOMAINS for SSRF protection.
"""

import time
import httpx
from fastapi import APIRouter, HTTPException
from models import ProxyRequest

router = APIRouter(tags=["proxy"])


# Only accept requests to these domains (SSRF Protection)
ALLOWED_DOMAINS = [".sslip.io", ".svc.cluster.local", "localhost", "127.0.0.1"]


@router.post("/proxy", summary="Test çağrıları için proxy")
async def proxy_request(req: ProxyRequest):
    # SSRF Protection
    if not any(domain in req.url for domain in ALLOWED_DOMAINS):
        raise HTTPException(
            status_code=400,
            detail="Güvenlik Kuralı: Proxy üzerinden yalnızca platform fonksiyon URL'lerine istek atılabilir."
        )

    start_time = time.time()
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.request(
                method=req.method,
                url=req.url,
                json=req.body if req.method in ["POST", "PUT", "PATCH"] else None,
                headers={**req.headers, "X-Forwarded-By": "VaaF-Platform"}
            )
            duration_ms = round((time.time() - start_time) * 1000, 2)

            try:
                body_content = resp.json()
            except Exception:
                body_content = resp.text

            return {
                "status": resp.status_code,
                "body": body_content,
                "duration_ms": duration_ms
            }
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Fonksiyon çağrısı zaman aşımına uğradı (30s).")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Fonksiyona erişilemedi: {str(e)}")
