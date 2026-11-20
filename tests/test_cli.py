"""CLI smoke tests (no Ollama needed)."""
import os
import subprocess
import sys


def run(args, tmp_path):
    env = {**os.environ, "SUDOKU_DATA_DIR": str(tmp_path), "SUDOKU_TRACE_DIR": str(tmp_path / "traces"), "PYTHONUTF8": "1"}
    return subprocess.run([sys.executable, "-m", "ta2.main", *args], capture_output=True, text=True, env=env)


def test_solve_mode_writes_real_trace(tmp_path):
    p = run(["--mode", "solve"], tmp_path)
    assert p.returncode == 0, p.stderr
    assert "Status: solved" in p.stdout and (tmp_path / "traces" / "latest_solve.json").exists()


def test_memory_mode_survives_without_heavy_imports(tmp_path):
    p = run(["--mode", "memory"], tmp_path)
    assert p.returncode == 0, p.stderr
    assert (tmp_path / "sudoku_memory.sqlite3").exists()


def test_checkpoint_then_resume_modes(tmp_path):
    assert run(["--mode", "checkpoint", "--thread-id", "cli-1"], tmp_path).returncode == 0
    p = run(["--mode", "resume", "--thread-id", "cli-1"], tmp_path)
    assert p.returncode == 0 and "status: solved" in p.stdout


def test_hop_limit_and_failure_modes(tmp_path):
    p = run(["--mode", "hop-limit"], tmp_path)
    assert p.returncode == 0 and "HOP_LIMIT_EXCEEDED" in p.stdout
