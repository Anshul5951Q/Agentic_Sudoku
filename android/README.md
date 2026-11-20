# SudokuMind AI — Android app (Expo + React Native + TypeScript + Expo Router)

Client for the local FastAPI backend (`../backend`, see `../docs/API.md`). **All Sudoku logic stays on the server**: the app
only draws what the API returns (validation, duplicates, uniqueness, statistics). Boards are 4×4 ints, `0` = empty,
coordinates are zero-based `[row, col]`.

```
app/                 Expo Router routes: (tabs)/{index,play,ai-lab,memory,analytics}, settings
src/components/      SudokuBoard, NumberPad, ConnectionBadge, shared UI
src/screens/         HomeScreen, PlayScreen, SettingsScreen, PlaceholderScreen
src/navigation/      tab definitions
src/services/        apiClient (typed errors), api (endpoint wrappers), config (base-URL resolution), storage
src/state/           ConnectionContext (backend vs Ollama status), playReducer (pure UI state)
src/hooks/           useValidation (debounced, server-authoritative), useHomeData
src/theme/ types/ constants/
tests/               Jest + React Native Testing Library (v14: async render/fireEvent)
```

## Run
```powershell
cd android
npm install
npm test            # 79 tests
npm run typecheck
npx expo start --android      # starts Metro and opens Expo Go on a running emulator
```
Start the backend first (`python -m backend` in the project root). Without it the app still opens and says so.

## Where the app looks for the backend (never hardcoded)
1. address saved in **Settings** → 2. `EXPO_PUBLIC_API_BASE_URL` → 3. the Expo dev-server host (finds your computer
automatically for a physical phone) → 4. if that host is unreachable on Android, the emulator alias `10.0.2.2` is tried once.

### Connectivity notes from testing on the Android emulator (Pixel_10a image, Android 17)
* The backend binds to `127.0.0.1` by default. A **physical phone** needs `SUDOKU_API_HOST=0.0.0.0` **and** a Windows Firewall
  rule allowing Python on your *private* network (Metro works because Node already has a rule). The API has no authentication:
  only do this on a network you trust.
* Observed: with the backend on `0.0.0.0` the emulator app reached it through the derived host address and loaded real data.
  With the backend on loopback only, requests from the **app** to `10.0.2.2:8000` timed out even though the same address
  answered from the `adb shell`; I did not find the cause. Treat the `10.0.2.2` fallback as best-effort.
* **Verified working on the emulator:** `adb reverse tcp:8000 tcp:8000` + `adb reverse tcp:8081 tcp:8081`, Metro started with
  `EXPO_PUBLIC_API_BASE_URL=http://localhost:8000`, and Expo Go opened with `exp://localhost:8081`. No firewall change, and the
  backend stays on loopback. Deep links work: `exp://localhost:8081/--/run/<run_id>`, `.../--/memory`.
* Metro started with `CI=1` does **not** watch files; after editing code restart Metro and relaunch Expo Go.
* Dev builds log connection decisions as `[connection] …` (host class and error kind only, no payloads).

## Known gaps
* The Analytics tab is still a placeholder; the search-tree visualisation and WebSocket live view are not built yet;
  "Solve with AI" on Play is disabled (runs start from the AI Lab).
* Multi-agent and CoT traces are written when the run ends, so their per-agent time spans are near zero; ToT spans include
  any pause or downtime (the UI labels them as spans, not active time).
* Plain `http://` works in Expo Go. A standalone APK needs cleartext traffic enabled via the build-properties plugin (Phase 7).
* Tab icons are emoji glyphs (no icon package added). Save stores the puzzle's clues, not in-progress entries.
* Physical-phone test not yet done (needs a phone).
