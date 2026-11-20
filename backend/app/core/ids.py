import uuid


def new_id(prefix: str) -> str:
    """Stable, URL-safe IDs: puzzle-/session-/run-/thread-/approval-/eval-/mem-."""
    return f"{prefix}-{uuid.uuid4().hex[:12]}"
