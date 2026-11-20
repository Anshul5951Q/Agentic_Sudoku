from __future__ import annotations
import argparse, json
from pathlib import Path
from .agents import BacktrackerAgent, valid_board
from .checkpointer import run_checkpointed
from .memory import SudokuMemory
from .rag import retrieve
from .supervisor import Supervisor
from .evaluation import run_evaluation, test_puzzles
from .agents import ProposerAgent

PUZZLE = [[0,0,3,4],[3,4,0,0],[0,1,4,0],[4,0,0,1]]
ROOT = Path(__file__).resolve().parent.parent
TRACE_DIR = ROOT / "traces"

def print_grid(board):
    if board is None:
        print("No verified solution found."); return
    for row in board: print(" ".join(map(str,row)))

def run_rag(query: str, k: int):
    docs = retrieve(query, k=k)
    if not docs:
        print("I don't know: no relevant context was retrieved."); return
    print(f"Retrieved {len(docs)} local corpus chunk(s):")
    for d in docs:
        print(f"- {d.metadata.get('heading')}: {d.page_content[:350]}")
    # The response is explicitly grounded in retrieved text, not an unsupported LLM claim.
    print("\nGrounded response: use the retrieved rule/dead-end information above. If it does not contain the requested answer, respond: I don't know.")

def main():
    parser=argparse.ArgumentParser(description="Local Sudoku TA2: memory, RAG, agents, voting, checkpointing, evaluation")
    parser.add_argument("--mode", choices=["solve","rag","evaluate","checkpoint","memory"], default="solve")
    parser.add_argument("--thread-id", default="sudoku-demo")
    parser.add_argument("--query", default="What should the solver do when a cell has no candidates?")
    parser.add_argument("--k", type=int, choices=[1,3], default=3)
    args=parser.parse_args()
    TRACE_DIR.mkdir(exist_ok=True)
    if args.mode == "memory":
        mem=SudokuMemory(); mem.seed()
        for key,value in mem.all(): print(f"{key}: {value}")
    elif args.mode == "rag":
        run_rag(args.query,args.k)
    elif args.mode == "checkpoint":
        result=run_checkpointed(PUZZLE,args.thread_id)
        print("thread_id:",args.thread_id,"status:",result.get("status"))
        print_grid(result.get("solution"))
        print("Checkpoints are stored in checkpoints.sqlite3. Reuse the same --thread-id to refer to this thread.")
    elif args.mode == "evaluate":
        rows=run_evaluation(); out=TRACE_DIR/"evaluation.json"
        out.write_text(json.dumps(rows,indent=2),encoding="utf-8")
        print(json.dumps(rows,indent=2)); print("Saved measured results to",out)
    else:
        mem=SudokuMemory(); mem.seed()
        print("Initial puzzle:"); print_grid(PUZZLE)
        print("\nLocal Qwen proposer (advisory only):")
        try:
            from .llm_proposer import ask_qwen_for_candidates
            cell, vals = ProposerAgent().propose(PUZZLE)
            if cell is not None:
                print(ask_qwen_for_candidates(PUZZLE, cell, vals))
        except Exception as e:
            print("Qwen proposer unavailable:", repr(e), "Check that Ollama is running and qwen2.5:3b is pulled.")
        print("\nRelevant remembered dead-end patterns:")
        for key,value in mem.all(): print(f"- {key}: {value}")
        print("\nLocal RAG evidence:")
        try: run_rag("dead-end branch and backtracking Sudoku",3)
        except Exception as e: print("RAG unavailable:",repr(e),"Run setup instructions in README.md; solver can still run.")
        result=Supervisor().solve_and_vote(PUZZLE)
        print("\nVerified voted solution:"); print_grid(result["solution"])
        print("Voting summary:",json.dumps({"votes":result["votes"],"valid":result["valid"],"solver_calls":result["solver_calls"],"elapsed_seconds":result["elapsed_seconds"]},indent=2))
        trace={"puzzle":PUZZLE,"solution":result["solution"],"valid":result["valid"],"votes":result["votes"],
               "runs":[{k:v for k,v in run.items() if k!="trace"} for run in result["runs"]],
               "search_traces":[{"agent":run["agent"],"trace":run["trace"]} for run in result["runs"]]}
        out=TRACE_DIR/"latest_solve.json"; out.write_text(json.dumps(trace,indent=2),encoding="utf-8")
        print("Saved search tree and agent traces to",out)
        if not result["valid"]: raise SystemExit("No verified solution; inspect traces before reporting results.")

if __name__ == "__main__": main()
