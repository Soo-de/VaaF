"""
routers/run.py — Subprocess sandbox execution with Server-Sent Events (SSE) streaming.
Executes user code in an isolated OS subprocess to prevent blocking FastAPI's event loop,
streaming stdout/stderr logs and execution results line-by-line to the client in real time.
"""

import os
import sys
import json
import time
import asyncio
import tempfile
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from services.sse import sse_event
from config import logger

router = APIRouter(tags=["run"])

RUNNER_SCRIPT = r"""
import sys
import json
import uuid
import traceback

temp_file = sys.argv[1]
with open(temp_file, "r", encoding="utf-8") as f:
    config = json.load(f)

code_str = config.get("code", "")
body_data = config.get("body", {})

sandbox_globals = {
    "__builtins__": __builtins__,
    "__name__": "__main__",
}

try:
    compiled = compile(code_str, "<user-code>", "exec")
    exec(compiled, sandbox_globals)
except SyntaxError as e:
    sys.stderr.write(f"SyntaxError: {e.msg} (Satır {e.lineno})\n")
    sys.stderr.flush()
    sys.exit(1)
except Exception as e:
    traceback.print_exc()
    sys.stderr.flush()
    sys.exit(1)

handler_fn = sandbox_globals.get("handler")
if not handler_fn or not callable(handler_fn):
    sys.stderr.write("Hata: 'handler(event, context)' fonksiyonu bulunamadı.\n")
    sys.stderr.flush()
    sys.exit(1)

event = {
    "body": body_data,
    "httpMethod": "POST",
    "headers": {"Content-Type": "application/json"}
}
context = {
    "function_name": "local-sandbox",
    "request_id": str(uuid.uuid4())
}

try:
    result = handler_fn(event, context)
    sys.stdout.flush()
    sys.stderr.flush()
    print("\n__VAAF_RUN_RESULT__:" + json.dumps(result, default=str), flush=True)
except Exception as e:
    traceback.print_exc()
    sys.stderr.flush()
    sys.exit(1)
"""


class RunRequest(BaseModel):
    code: str = Field(..., min_length=1)
    body: dict = Field(default_factory=dict)
    environment: dict[str, str] = Field(default_factory=dict)


@router.post("/functions/run", summary="Deploy etmeden kodu hızlı çalıştır (SSE Canlı Akış)")
async def run_code(req: RunRequest):
    async def sse_generator():
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as f:
            json.dump({"code": req.code, "body": req.body}, f)
            temp_path = f.name

        env = {**os.environ, **req.environment}
        start_time = time.time()
        timeout_seconds = 30.0

        yield sse_event("step", "▶ Sandbox ortamı başlatılıyor...")

        proc = None
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable,
                "-u",
                "-c",
                RUNNER_SCRIPT,
                temp_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
            )

            deadline = start_time + timeout_seconds

            while True:
                remaining = deadline - time.time()
                if remaining <= 0:
                    try:
                        proc.kill()
                    except Exception:
                        pass
                    yield sse_event("error", f"Zaman aşımı ({int(timeout_seconds)}s limiti aşıldı).")
                    yield sse_event("done", json.dumps({"status": "timeout"}))
                    return

                try:
                    line_bytes = await asyncio.wait_for(
                        proc.stdout.readline(), timeout=min(remaining, 0.5)
                    )
                except asyncio.TimeoutError:
                    if proc.returncode is not None:
                        break
                    continue

                if not line_bytes:
                    break

                line = line_bytes.decode("utf-8", errors="replace").rstrip("\r\n")

                if line.startswith("__VAAF_RUN_RESULT__:"):
                    result_json = line[len("__VAAF_RUN_RESULT__:"):].strip()
                    try:
                        parsed = json.loads(result_json)
                    except Exception:
                        parsed = result_json
                    yield sse_event("result", json.dumps(parsed, default=str))
                elif line:
                    yield sse_event("log", line)

            await proc.wait()
            duration_ms = round((time.time() - start_time) * 1000, 2)

            if proc.returncode == 0:
                yield sse_event("step", f"✅ Çalıştırma tamamlandı ({duration_ms}ms)")
                yield sse_event("done", json.dumps({"status": "success", "duration_ms": duration_ms}))
            else:
                yield sse_event("error", f"İşlem hata koduyla sonlandı (kod: {proc.returncode})")
                yield sse_event("done", json.dumps({"status": "error", "duration_ms": duration_ms}))

        except Exception as e:
            logger.exception("Sandbox execution failed")
            yield sse_event("error", f"Sistem hatası: {str(e)}")
            yield sse_event("done", json.dumps({"status": "error"}))
        finally:
            if proc and proc.returncode is None:
                try:
                    proc.kill()
                except Exception:
                    pass
            try:
                os.remove(temp_path)
            except Exception:
                pass

    return StreamingResponse(
        sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
