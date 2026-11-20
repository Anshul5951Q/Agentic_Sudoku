"""TA1 baseline must stay byte-identical (hashes recorded in docs/PHASE0_AUDIT.md before any change)."""
import hashlib
from pathlib import Path

EXPECTED = {
    "cot_attempt.py": "455118628fcf046aa03a690f66374655e9bb65c83a3dcc34f2f6c105b63ddd5c",
    "sudoku_tot.py": "3a0cbe679dba36e678dc2f008cad11e456b18e2bf4b896ab85d45cf4f46f4698",
    "tot_solver.py": "f940cbca42585fa3b816cf77886e89c8905ad2c45a38969ffb1cf0424cf8415f",
}
TA1 = Path(__file__).resolve().parent.parent / "ta1"


def test_ta1_files_unchanged():
    for name, digest in EXPECTED.items():
        assert hashlib.sha256((TA1 / name).read_bytes()).hexdigest() == digest, name
