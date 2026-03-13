"""
Admin routes.

GET  /admin/logs          — last N lines from logs/app.log (JSON)
GET  /admin/logs/stream   — SSE stream of new log lines as they arrive
"""
import asyncio
import logging
import os
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

log = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["Admin"])

_LOG_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "logs")
)
APP_LOG_FILE = os.path.join(_LOG_DIR, "app.log")


def _tail_lines(path: str, n: int) -> list[str]:
    """Return the last `n` lines of a file efficiently."""
    try:
        with open(path, "rb") as f:
            # Read up to 8 KB per line estimate, expand if needed
            chunk = 1024 * 8 * max(1, n // 50)
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - chunk))
            raw = f.read().decode("utf-8", errors="replace")
            lines = raw.splitlines()
            return lines[-n:]
    except FileNotFoundError:
        return []
    except Exception as e:
        log.warning("admin tail failed: %s", e)
        return []


@router.get("/logs")
async def get_logs(n: int = Query(default=200, ge=1, le=2000, description="Number of lines to return")):
    """Return the last N lines of the application log file."""
    lines = _tail_lines(APP_LOG_FILE, n)
    return {
        "file":  APP_LOG_FILE,
        "lines": len(lines),
        "log":   lines,
    }


@router.get("/logs/stream")
async def stream_logs(poll_ms: int = Query(default=500, ge=100, le=5000)):
    """
    Server-Sent Events stream of new log lines.
    Connect with:  curl -N http://localhost:8000/admin/logs/stream
    """
    async def generator():
        try:
            size = os.path.getsize(APP_LOG_FILE) if os.path.exists(APP_LOG_FILE) else 0
        except OSError:
            size = 0

        yield "data: [connected — tailing logs/app.log]\n\n"

        while True:
            await asyncio.sleep(poll_ms / 1000)
            try:
                new_size = os.path.getsize(APP_LOG_FILE)
            except OSError:
                continue

            if new_size > size:
                try:
                    with open(APP_LOG_FILE, "rb") as f:
                        f.seek(size)
                        chunk = f.read(new_size - size).decode("utf-8", errors="replace")
                    size = new_size
                    for line in chunk.splitlines():
                        if line.strip():
                            yield f"data: {line}\n\n"
                except Exception:
                    pass
            elif new_size < size:
                # File was rotated
                size = new_size

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
