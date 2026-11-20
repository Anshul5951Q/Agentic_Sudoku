"""Tool-failure handling (Unit 3, U3-4): inject, catch, explain, retry, route to a fallback."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from .trace import Recorder

log = logging.getLogger("sudokumind.tools")


class ToolError(Exception):
    """A tool failed (really, or because a failure was injected)."""


class BudgetExceeded(Exception):
    """The tool-call budget for a run was used up."""


class FailureInjector:
    """Deterministic failure injection: ``FailureInjector({"rag_retrieve": 1})`` fails the next call once."""

    def __init__(self, plan: dict[str, int] | None = None):
        self.plan = dict(plan or {})
        self.injected: list[str] = []

    def maybe_fail(self, tool: str) -> None:
        if self.plan.get(tool, 0) > 0:
            self.plan[tool] -= 1
            self.injected.append(tool)
            raise ToolError(f"injected failure in tool '{tool}'")


@dataclass
class ToolResult:
    ok: bool
    value: Any = None
    attempts: int = 0
    recovered: bool = False
    via_fallback: bool = False
    explanation: str = ""
    errors: list[str] = field(default_factory=list)


class ToolRunner:
    def __init__(self, tools: dict[str, Callable], fallbacks: dict[str, Callable] | None = None,
                 injector: FailureInjector | None = None, max_retries: int = 1, max_calls: int = 20,
                 recorder: Recorder | None = None):
        self.tools, self.fallbacks = tools, fallbacks or {}
        self.injector = injector or FailureInjector()
        self.max_retries, self.max_calls = max_retries, max_calls
        self.rec = recorder
        self.calls = 0
        self.failures = 0

    def _emit(self, event: str, **kw: Any) -> None:
        if self.rec:
            self.rec.emit(event, "Supervisor", **kw)

    def call(self, name: str, *args: Any, **kw: Any) -> ToolResult:
        res = ToolResult(ok=False)
        for attempt in range(1, self.max_retries + 2):
            if self.calls >= self.max_calls:
                raise BudgetExceeded(f"tool-call budget of {self.max_calls} exhausted")
            self.calls += 1
            res.attempts = attempt
            self._emit("tool_call", reason_code="TOOL_CALL", reason=f"{name} attempt {attempt}",
                       data={"tool": name, "attempt": attempt})
            try:
                self.injector.maybe_fail(name)
                if name not in self.tools:
                    raise ToolError(f"unknown tool '{name}'")
                res.value, res.ok = self.tools[name](*args, **kw), True
                if attempt > 1:
                    res.recovered = True
                    res.explanation = f"{name} succeeded on retry {attempt - 1}"
                    self._emit("tool_recovered", reason_code="RETRY_SUCCEEDED", reason=res.explanation,
                               data={"tool": name, "attempts": attempt})
                return res
            except Exception as e:  # tool errors must never crash the supervisor
                self.failures += 1
                # Only our own ToolError text is safe to record; anything else may contain paths/secrets, so the trace gets
                # just the exception type and the detail goes to the server log.
                if isinstance(e, ToolError):
                    msg = f"ToolError: {str(e)[:200]}"
                else:
                    msg = f"{type(e).__name__} (details in the server log)"
                    log.warning("tool %s failed: %r", name, e)
                res.errors.append(msg)
                self._emit("tool_failure", reason_code="TOOL_FAILURE",
                           reason=f"{name} failed ({msg}); " + ("retrying" if attempt <= self.max_retries else "no retries left"),
                           data={"tool": name, "attempt": attempt})
        if name in self.fallbacks:
            try:
                res.value, res.ok, res.recovered, res.via_fallback = self.fallbacks[name](*args, **kw), True, True, True
                res.explanation = f"{name} failed {res.attempts}x; routed to fallback"
                self._emit("tool_recovered", reason_code="FALLBACK_USED", reason=res.explanation,
                           data={"tool": name, "attempts": res.attempts, "fallback": True})
                return res
            except Exception as e:
                res.errors.append(f"fallback {type(e).__name__}: {str(e)[:200]}")
        res.explanation = f"{name} unavailable after {res.attempts} attempt(s); continuing without it"
        self._emit("tool_failure", reason_code="TOOL_UNAVAILABLE", reason=res.explanation, data={"tool": name})
        return res
