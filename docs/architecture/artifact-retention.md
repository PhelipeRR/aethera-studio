# Artifact retention and cleanup audit

Audit date: 2026-11-06. This is an inventory and retention decision, not a deletion authorization.

| Item | Git | Evidence / references | Decision |
|---|---|---|---|
| `.release-test-data-2/` | untracked | Windows install/uninstall homologation | Preserve as release evidence; do not delete or auto-clean |
| `.debug-data/` | untracked | diagnostic/runtime evidence | Preserve until the release evidence is archived; contains local application data |
| `.electron-diagnostic-data/` | untracked, empty | release decision only | Preserve directory state; no contents to remove |
| `.motion-runtime/` | untracked | Velix rendering tests and runtime | Preserve; generated runtime may contain reproducibility inputs |
| `tmp-motion-test.mp4` | untracked | baseline/release evidence | Preserve as unique media evidence |
| `.rag-symlink-test-O7HpGa/` | untracked | security fixture inventory | Preserve as security evidence; never delete as generic temp data |
| `artifacts/` | tracked | E2E and visual evidence consumers | Preserve; tracked evidence is not cleanup material |
| `renders/` | tracked | integration tests, manifests and reports | Preserve; contains reproducible outputs and reports |
| `prints/` | tracked | integration tests and visual evidence | Preserve; tracked evidence is not cleanup material |
| `test-results/` | ignored, local output | Playwright and release evidence references | Preserve current evidence; future runs may rotate under CI retention policy |
| `playwright-report/` | ignored, currently empty | Playwright report configuration | Keep ignored; no deletion performed |

No item was removed. No item was shown to be disposable, user-data-free, unreferenced, and reproducible enough to authorize deletion. Migrations, fixtures, snapshots, history and user data remain untouched.

## Safe ignore policy

The following local-only generated paths are ignored to prevent accidental commits while preserving existing contents: release test data, debug data, Electron diagnostics, motion runtime, RAG symlink fixtures and the temporary motion video. Tracked evidence directories remain tracked and are intentionally not ignored.

## Debt audit

The scan found intentional future-phase placeholders (`PlannedPage`, route metadata), UI input placeholders, and documentation references to TODO/planned work. No dead route, unused IPC channel, pass-through module, unused import, duplicate test, or unreferenced script was proven by this repository-wide scan alone. These require focused call-graph or runtime analysis; no speculative refactor was applied.

The remaining externally blocked items are signing, updater infrastructure, signed HTTPS extension registry, previous-installer upgrade validation and corporate credentials/endpoints.
