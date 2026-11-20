"""Small helper that records ordered, validated TraceEvents for non-search components."""
from __future__ import annotations

from typing import Any

from .models import TraceEvent


class Recorder:
    def __init__(self, run_id: str, thread_id: str | None = None):
        self.run_id, self.thread_id = run_id, thread_id or run_id
        self.events: list[dict] = []

    def emit(self, event: str, agent: str, **kw: Any) -> dict:
        seq = len(self.events)
        ev = TraceEvent(event_id=f"{self.run_id}-event-{seq:05d}", run_id=self.run_id,
                        thread_id=self.thread_id, sequence=seq, event=event, agent=agent, **kw).model_dump()
        self.events.append(ev)
        return ev
