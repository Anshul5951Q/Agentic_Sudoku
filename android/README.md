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
npm test
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

## Screens added in the analytics/hardening phase
* **History** (`/history`, from Home and Analytics): saved sessions → session detail → reopen in Play, resume an eligible
  checkpointed run, open a finished run as a **recorded replay**, export its trace as JSON (Android share sheet), tick two
  runs and **compare** them (`/compare`, backend refuses runs of different puzzles).
* **Analytics** tab: evaluation-run interface (start, poll, pick a stored evaluation), five-case TA1-vs-TA2 table (every
  cell opens the recorded trace behind it, `/eval-trace`), one-measure-per-chart bars for time / nodes / solver calls /
  LLM calls, single vs multi-agent trade-off computed from the stored values, sequential vs parallel, CoT vs ToT,
  memory off/on, RAG k=1 vs k=3, voting tables, challenge analysis, and the stored-run comparisons with run links.
* **Recorded replay (offline)** (`/replay`): two real traces bundled in `assets/recorded/`, labelled as recordings.

## Build the APK (local, no cloud build)
```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
npm run prebuild:android          # generates android/android (git-ignored)
npm run build:apk                 # -> android/android/app/build/outputs/apk/release/app-release.apk
& "$env:ANDROID_HOME\platform-toolsdb.exe" install -r androidppuild\outputspkeleasepp-release.apk
```
The release APK bundles the JavaScript (no Metro needed) and is signed with the Expo template's debug keystore (fine
for local installs, not for a store). Connect it to the backend as in `../docs/LOCAL_NETWORK.md`.

## Known gaps
* Multi-agent and CoT traces are written when the run ends, so their per-agent time spans are near zero; ToT spans include
  any pause or downtime (the UI labels them as spans, not active time).
* Tab icons are emoji glyphs (no icon package added). Save stores the puzzle's clues, not in-progress entries.
* Export uses the Android share sheet (text JSON); there is no direct "save to file" without adding a native dependency.
