"""
services/sse.py — Server-Sent Event (SSE) formatlayıcı
Deploy adımlarını (step, log, url, done, error) frontend'e canlı akıtmak için kullanılır.
"""
import json


def sse_event(event: str, data: str | dict) -> str:
    """generates SSE frame that fits W3C standard"""
    if isinstance(data, dict):
        data = json.dumps(data)

    # Multiline data should be indented with 'data: '
    # Split the data into lines and send each line as a separate SSE event
    lines = str(data).split("\n")
    data_payload = "\n".join(f"data: {line}" for line in lines)
    return f"event: {event}\n{data_payload}\n\n"
