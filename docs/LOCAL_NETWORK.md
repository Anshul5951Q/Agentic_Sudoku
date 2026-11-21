# Local-network setup: phone or emulator ↔ backend

The backend has **no authentication**. It is meant for your own computer and a network you trust. Nothing in the
repository contains a LAN address: you enter yours at run time.

The app looks for the backend in this order (`android/src/services/config.ts`):
1. the address saved in **Settings** (gear icon, top right)
2. `EXPO_PUBLIC_API_BASE_URL` (Metro / Expo Go only; it is baked in at bundle time)
3. the Expo dev-server host (Expo Go on a phone finds your computer automatically)
4. the emulator alias `http://10.0.2.2:8000` (best effort)

## Option A: USB cable with `adb reverse` (recommended; no firewall change)

Works for the **installed APK** and for Expo Go, on a physical phone or the emulator. The backend stays on loopback.

```powershell
# computer
python -m backend                              # http://127.0.0.1:8000
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices      # phone listed as "device"
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:8000 tcp:8000
```
Phone: **Settings (gear) → type `http://localhost:8000` in the address field → Save address → Test connection**. The header badge turns to *API connected*.
Repeat `adb reverse` after re-plugging the cable.

## Option B: same Wi-Fi network

```powershell
$env:SUDOKU_API_HOST = "0.0.0.0"               # listen on the LAN (trusted network only)
python -m backend
ipconfig                                       # note this PC's IPv4 address on the Wi-Fi adapter
```
* Windows Firewall must allow inbound TCP 8000 for Python on the **Private** profile only. Run in an *admin* PowerShell:
  `New-NetFirewallRule -DisplayName "SudokuMind API (private)" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private`
  Remove it afterwards: `Remove-NetFirewallRule -DisplayName "SudokuMind API (private)"`.
* The Wi-Fi network must be set to **Private** in Windows, and the router must not isolate clients (guest networks often do).
* Phone: **Settings (gear) → address field `http://<your PC IPv4>:8000` → Save address**.

## Option C: Android emulator

`adb reverse tcp:8000 tcp:8000` and `http://localhost:8000` (Option A) is the verified route. `10.0.2.2` against a
loopback-only backend timed out in our tests (cause not found; see `android/README.md`).

## Cleartext HTTP

The APK allows plain `http://` (`usesCleartextTraffic`, set through `expo-build-properties` in `app.json`), because
the backend is local and has no TLS. Do not expose port 8000 to the internet.

## Troubleshooting

| Symptom | Check |
|---|---|
| Badge *API unreachable* | `curl http://127.0.0.1:8000/api/health` on the PC; `adb reverse --list`; the address in Settings |
| *LLM unavailable* / *missing models* | `ollama list`; `ollama pull qwen2.5:3b`, `ollama pull nomic-embed-text` |
| Works on the emulator, not the phone | Option B firewall/profile, or use Option A |
| Run stuck on *interrupted* after a PC restart | open it from **History** and tap **Resume from checkpoint** |
