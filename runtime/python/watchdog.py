"""
watchdog.py — FaaS Python Runtime Engine (In-Pod HTTP Server)
============================================================
1. Dynamically imports user code from /var/task/handler.py via importlib.
2. Starts an HTTP server listening on the port designated by Knative (PORT=8080).
3. Adapts incoming HTTP requests into an AWS Lambda-compatible (event, context) model.
4. Executes the user function and returns the result as an HTTP JSON response.
"""

import importlib.util
import json
import os
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

HANDLER_PATH = os.getenv("HANDLER_PATH", "/var/task/handler.py")
HANDLER_FUNCTION = os.getenv("HANDLER_FUNCTION", "handler")
PORT = int(os.getenv("PORT", "8080"))


def load_user_module():
    """Dynamically loads the user's handler module mounted via ConfigMap."""
    if not os.path.exists(HANDLER_PATH):
        raise FileNotFoundError(f"Handler file not found at: {HANDLER_PATH}")

    task_dir = os.path.dirname(HANDLER_PATH)
    if task_dir not in sys.path:
        sys.path.insert(0, task_dir)

    spec = importlib.util.spec_from_file_location("user_handler", HANDLER_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"Failed to load module spec from: {HANDLER_PATH}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    # Primary entrypoint check: handler() followed by main() fallback
    func = getattr(module, HANDLER_FUNCTION, None) or getattr(module, "main", None)
    if func is None:
        raise AttributeError(
            f"'{HANDLER_PATH}' does not define a '{HANDLER_FUNCTION}()' or 'main()' function."
        )
    return func


class FaaSHTTPHandler(BaseHTTPRequestHandler):
    user_handler = None

    def do_POST(self):
        self._process_request()

    def do_GET(self):
        # Health probe endpoints for Kubernetes / Knative readiness
        if self.path in ["/healthz", "/livez"]:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status": "ok"}')
            return

        self._process_request()

    def _process_request(self):
        start_time = time.time()

        # 1. Read request payload
        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b""

        try:
            body_data = json.loads(raw_body.decode("utf-8")) if raw_body else {}
        except Exception:
            body_data = {"raw": raw_body.decode("utf-8", errors="replace")}

        # 2. Build Event and Context dictionaries
        event = {
            "httpMethod": self.command,
            "path": self.path,
            "headers": dict(self.headers),
            "body": body_data,
        }

        context = {
            "function_name": os.getenv("FUNCTION_NAME", "unnamed-function"),
            "request_id": self.headers.get("X-Request-Id", f"req-{int(time.time()*1000)}"),
            "memory_limit_mb": int(os.getenv("MEMORY_LIMIT_MB", "512")),
        }

        # 3. Execute the user function
        try:
            result = FaaSHTTPHandler.user_handler(event, context)

            # Support both explicit {statusCode, body} dicts and raw returns
            if isinstance(result, dict) and "statusCode" in result:
                status_code = result.get("statusCode", 200)
                body_content = result.get("body", {})
            else:
                status_code = 200
                body_content = result

            response_bytes = (
                json.dumps(body_content).encode("utf-8")
                if not isinstance(body_content, str)
                else body_content.encode("utf-8")
            )

        except Exception as e:
            status_code = 500
            response_bytes = json.dumps({
                "errorMessage": str(e),
                "errorType": type(e).__name__,
                "stackTrace": traceback.format_exc().splitlines(),
            }).encode("utf-8")

        duration_ms = (time.time() - start_time) * 1000

        # 4. Send HTTP response
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("X-Duration-Ms", f"{duration_ms:.2f}")
        self.end_headers()
        self.wfile.write(response_bytes)

        # Output structured access log to stdout
        print(
            f"[{context['request_id']}] {self.command} {self.path} -> {status_code} ({duration_ms:.1f}ms)",
            flush=True,
        )

    def log_message(self, format, *args):
        # Suppress default BaseHTTPRequestHandler access log format
        pass


if __name__ == "__main__":
    print(f"🚀 FaaS Python Runtime starting on port {PORT}...", flush=True)
    try:
        FaaSHTTPHandler.user_handler = load_user_module()
        print("✅ User handler loaded successfully.", flush=True)
    except Exception as e:
        print(f"❌ Failed to load user handler: {e}", flush=True)
        traceback.print_exc()
        sys.exit(1)

    server = HTTPServer(("0.0.0.0", PORT), FaaSHTTPHandler)
    server.serve_forever()
