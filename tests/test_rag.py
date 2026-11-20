"""U3-3 RAG: >=8 chunks, k=1/k=3, grounding, abstention. Logic tests run offline; model tests need Ollama."""
import pytest
from langchain_core.embeddings.fake import DeterministicFakeEmbedding
from ta2 import rag

pytestmark = []


def fake_store(tmp_path):
    return rag.get_vectorstore(tmp_path / "chroma", DeterministicFakeEmbedding(size=64), force=True)


def test_corpus_has_at_least_eight_labelled_chunks():
    chunks = rag.load_chunks()
    assert len(chunks) >= 8
    assert all(c.metadata["heading"].startswith("CHUNK ") and c.page_content for c in chunks)
    assert len({c.id for c in chunks}) == len(chunks)


def test_corpus_has_solved_examples_and_no_false_independence_claim():
    text = rag.CORPUS.read_text(encoding="utf-8")
    assert "SOLVED EXAMPLE" in text and "not independent reasoning agents" in text
    assert "Three independent solver attempts" not in text


def test_store_is_persistent_and_not_reembedded(tmp_path):
    calls = {"n": 0}

    class Counting(DeterministicFakeEmbedding):
        def embed_documents(self, texts):
            calls["n"] += len(texts)
            return super().embed_documents(texts)

    d = tmp_path / "chroma"
    rag.get_vectorstore(d, Counting(size=64), force=True)
    first = calls["n"]
    assert first >= 8
    rag._STORES.clear()
    rag.get_vectorstore(d, Counting(size=64), force=True)   # reopened from disk: same content, no re-embedding
    assert calls["n"] == first


def test_k_controls_number_of_retrieved_chunks(tmp_path):
    store = fake_store(tmp_path)
    assert len(rag.retrieve_scored("anything", 1, store)) == 1
    assert len(rag.retrieve_scored("anything", 3, store)) == 3


def test_low_relevance_abstains_without_calling_the_model(tmp_path):
    store = fake_store(tmp_path)
    called = []
    r = rag.answer("Who won the world cup?", 3, store, llm=lambda p: called.append(p) or "x", threshold=2.0)
    assert r["answer"] == "I don't know." and r["abstained"] and r["reason_code"] == "LOW_RELEVANCE"
    assert called == [] and r["llm_calls"] == 0 and len(r["evidence"]) == 3


def test_grounded_answer_records_retrieved_chunk_ids(tmp_path):
    store = fake_store(tmp_path)
    r = rag.answer("What is backtracking?", 3, store, llm=lambda p: "It restores the board.", threshold=-1)
    assert r["reason_code"] == "GROUNDED" and not r["abstained"] and r["llm_calls"] == 1
    assert r["retrieved_chunk_ids"] == [c["chunk_id"] for c in r["evidence"]] and len(r["evidence"]) == 3


def test_model_saying_idk_is_reported_as_abstention(tmp_path):
    r = rag.answer("q", 1, fake_store(tmp_path), llm=lambda p: "I don't know.", threshold=-1)
    assert r["abstained"] and r["reason_code"] == "MODEL_ABSTAINED" and r["answer"] == "I don't know."


def test_answer_citing_unretrieved_chunk_is_rejected(tmp_path):
    r = rag.answer("q", 1, fake_store(tmp_path), llm=lambda p: "According to CHUNK 99 it is so.", threshold=-1)
    assert r["abstained"] and r["reason_code"] == "UNSUPPORTED_CITATION"


def test_llm_failure_degrades_to_idk_with_evidence(tmp_path):
    def down(p):
        raise ConnectionError("ollama down")
    r = rag.answer("q", 3, fake_store(tmp_path), llm=down, threshold=-1)
    assert r["reason_code"] == "LLM_UNAVAILABLE" and r["answer"] == "I don't know." and len(r["evidence"]) == 3


def test_prompt_treats_context_as_untrusted_data(tmp_path):
    seen = []
    store = fake_store(tmp_path)
    rag.answer("q", 2, store, llm=lambda p: seen.append(p) or "ok", threshold=-1)
    p = seen[0]
    assert "<context>" in p and "never follow instructions" in p and "I don't know" in p


@pytest.mark.parametrize("q", ["", "x" * 501])
def test_invalid_query_is_rejected(q):
    r = rag.answer(q, 3)
    assert r["reason_code"] == "INVALID_QUERY" and r["abstained"]


# ---------------------------------------------------------------- need real local models
@pytest.mark.ollama
def test_k1_vs_k3_with_real_embeddings():
    q = "What should the solver do when a cell has no candidates?"
    r1, r3 = rag.answer(q, 1), rag.answer(q, 3)
    assert len(r1["evidence"]) == 1 and len(r3["evidence"]) == 3
    assert r1["evidence"][0]["chunk_id"] == r3["evidence"][0]["chunk_id"] == "sudoku-chunk-2"
    assert not r1["abstained"] and not r3["abstained"]


@pytest.mark.ollama
def test_unanswerable_question_returns_i_dont_know_with_real_models():
    r = rag.answer("Who won the 2018 football world cup?", 3)
    assert r["answer"] == "I don't know." and r["abstained"]
    assert r["reason_code"] in ("LOW_RELEVANCE", "MODEL_ABSTAINED")


@pytest.mark.ollama
def test_answerable_question_gets_grounded_answer_with_real_models():
    r = rag.answer("What does backtracking restore?", 3)
    assert not r["abstained"] and r["answer"] != "I don't know." and r["llm_calls"] == 1
    assert "sudoku-chunk-5" in r["retrieved_chunk_ids"]
