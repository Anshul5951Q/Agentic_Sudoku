"""Local Chroma RAG using Ollama nomic-embed-text; no remote APIs."""
from pathlib import Path
from langchain_chroma import Chroma
from langchain_ollama import OllamaEmbeddings
from langchain_core.documents import Document

BASE = Path(__file__).resolve().parent
CORPUS = BASE / "corpus" / "sudoku_knowledge.txt"
PERSIST = BASE.parent / "chroma_db"


def load_chunks() -> list[Document]:
    text = CORPUS.read_text(encoding="utf-8")
    chunks = []
    for block in text.split("\n\n"):
        block = block.strip()
        if block:
            first, _, body = block.partition("\n")
            chunks.append(Document(page_content=body.strip(), metadata={"heading": first.strip("[]"), "source": CORPUS.name}))
    return chunks


def get_vectorstore() -> Chroma:
    embeddings = OllamaEmbeddings(model="nomic-embed-text")
    store = Chroma(collection_name="sudoku_knowledge", embedding_function=embeddings,
                   persist_directory=str(PERSIST))
    # Idempotently seed/refresh the local corpus using stable IDs.
    docs = load_chunks()
    ids = [f"sudoku-chunk-{i}" for i in range(len(docs))]
    store.add_documents(documents=docs, ids=ids)
    return store


def retrieve(query: str, k: int = 3) -> list[Document]:
    return get_vectorstore().similarity_search(query, k=k)


def grounded_context(query: str, k: int = 3) -> str:
    docs = retrieve(query, k=k)
    if not docs:
        return "NO_RELEVANT_CONTEXT"
    return "\n\n".join(f"[{d.metadata.get('heading','source')}] {d.page_content}" for d in docs)
