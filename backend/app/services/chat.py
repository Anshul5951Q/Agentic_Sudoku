"""Short-term (thread) memory over HTTP: wraps ta2.chat_memory. Memory ON = LangGraph SQLite checkpoint per thread_id;
memory OFF = no checkpointer, so every turn is independent (the 'amnesia' case)."""
from __future__ import annotations

from ta2 import chat_memory
from ta2.checkpointer import open_saver

from ..core.errors import not_found
from ..core.ids import new_id


class ChatService:
    def __init__(self, settings, llm=None):
        self.settings, self.llm = settings, llm

    def send(self, message: str, thread_id: str | None, memory: bool, puzzle) -> dict:
        if memory:
            tid = thread_id or new_id("chat")
            with open_saver(self.settings.checkpoint_db) as saver:
                out = chat_memory.send(chat_memory.build_chat_graph(saver, llm=self.llm), message, thread_id=tid, puzzle=puzzle)
            note = "Memory ON: the model received the whole conversation stored under this thread_id."
        else:
            tid = None
            out = chat_memory.send(chat_memory.build_chat_graph(None, llm=self.llm), message)
            note = "Memory OFF: no checkpoint, so the model saw only this one message."
        return {"thread_id": tid, "memory": memory, "reply": out["reply"], "messages_seen_by_model": out["messages_seen_by_model"],
                "history_len": out["history_len"], "note": note}

    def history(self, thread_id: str) -> dict:
        with open_saver(self.settings.checkpoint_db) as saver:
            app = chat_memory.build_chat_graph(saver, llm=self.llm)
            snap = app.get_state({"configurable": {"thread_id": thread_id}})
        msgs = (snap.values or {}).get("messages")
        if not msgs:
            raise not_found("thread", thread_id)
        return {"thread_id": thread_id, "messages": [{"role": m.type, "content": str(m.content)} for m in msgs],
                "puzzle": snap.values.get("puzzle"), "restored_from_checkpoint": True}
