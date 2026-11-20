"""Short-term, multi-turn memory (Unit 3, U3-1): a LangGraph chat graph checkpointed per ``thread_id``.

With a checkpointer and a stable thread_id the model receives the whole conversation so far; without
memory (no checkpointer) every turn is independent, which demonstrates the "amnesia" case. The graph
state also carries the current puzzle, so follow-ups can depend on earlier turns.
"""
from __future__ import annotations

from typing import Annotated, Any, Callable, TypedDict

from langchain_core.messages import AIMessage, AnyMessage, HumanMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from . import config


class ChatState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]
    puzzle: Any
    seen: int


def _default_llm(messages: list) -> str:
    from langchain_ollama import ChatOllama
    return str(ChatOllama(model=config.LLM_MODEL, temperature=0, num_predict=160).invoke(messages).content)


def build_chat_graph(checkpointer=None, llm: Callable[[list], str] | None = None):
    model = llm or _default_llm

    def assistant(state: ChatState) -> ChatState:
        msgs = state["messages"]
        return {"messages": [AIMessage(content=model(msgs))], "seen": len(msgs)}

    g = StateGraph(ChatState)
    g.add_node("assistant", assistant)
    g.add_edge(START, "assistant")
    g.add_edge("assistant", END)
    return g.compile(checkpointer=checkpointer)


def send(app, text: str, thread_id: str | None = None, puzzle: Any = None) -> dict:
    """One user turn. Returns {reply, messages_seen_by_model, history_len}."""
    payload: dict = {"messages": [HumanMessage(content=text)]}
    if puzzle is not None:
        payload["puzzle"] = puzzle
    cfg = {"configurable": {"thread_id": thread_id}} if thread_id else {}
    out = app.invoke(payload, cfg)
    return {"reply": out["messages"][-1].content, "messages_seen_by_model": out["seen"],
            "history_len": len(out["messages"]), "thread_id": thread_id}


def history(app, thread_id: str) -> list[dict]:
    snap = app.get_state({"configurable": {"thread_id": thread_id}})
    return [{"role": m.type, "content": m.content} for m in snap.values.get("messages", [])]
