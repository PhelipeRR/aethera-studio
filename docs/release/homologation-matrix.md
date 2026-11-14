# Homologation matrix — Phase 5.2

Updated 2026-11-06. This matrix records only observable results from the current
Windows workstation and clearly separates real, local, simulated and blocked
scenarios. No provider authentication was queried or used automatically.

## Environment

| Field | Observed value |
|---|---|
| OS | Windows 11 Pro 64-bit, build 26300 (`10.0.26300`) |
| Node / npm | v24.17.0 / 11.13.0 |
| Git | 2.54.0.windows.1 |
| App | NeuralBridge 0.1.58 |
| Installer | `dist/NeuralBridge-Setup-0.1.58-x64.exe`, unsigned local build |
| Real Claude CLI | detected, `2.1.317`; authentication not queried |
| Real Codex CLI | detected, `codex-cli 0.166.0`; authentication not queried |
| signtool | unavailable (`spawnSync signtool.exe ENOENT`) |
| FFmpeg / external media services | not detected or not exercised in this matrix |

| Area | Evidence | Result | Boundary |
|---|---|---|---|
| Packaged Electron | `dist/win-unpacked/NeuralBridge.exe` via Playwright `_electron` | Passed | Build is unsigned; Authenticode remains a Phase 4.1 blocker |
| First run / Core without extensions | isolated `NB_DATA_DIR`, fake Claude/Codex, `extensions.list()` | Passed | No real account or registry used |
| Request → approval → execution → validation | typed preload task API, fixture Git project, approval and Codex edit | Passed | Fixture only; no automatic commit |
| Evidence and learning | persisted task detail, redacted learning output and `brain.learning()` | Passed | Learning approval remains user-controlled |
| Cancellation | three isolated packaged runs | Passed 3/3 | Bounded polling; no fixed sleeps |
| Restart / recovery / redaction | three runs reuse the same data directory, resume persisted task, assert secret absent from detail | Passed 3/3 | Fake credential exists only in disposable fixture |
| Provider failure / retry safety | three isolated `FALHAR` runs, failed state and no duplicate file effect | Passed 3/3 | Fake provider; real timeout remains homologation work |
| Provider timeout / recovery classification | three isolated `TIMEOUT` runs and persisted execution snapshot | Passed 3/3 | Simulated provider timeout; no retry loop |
| Diagnostics redaction | `scripts/export-diagnostics.mjs` over the isolated app data directory | Passed | Export is local and unsigned |
| Renderer states | existing packaged Chat E2E: loading/streaming, error/degraded extension, approval, success, cancellation and recovery/history | Passed 7/7 | Uses the same fake-provider fixture harness |
| Windows clean install / first launch | NSIS `/S /D=.release-test-install-2` returned 0, installed `NeuralBridge.exe` and uninstaller; app process was started with isolated `NB_DATA_DIR` | Approved by isolated test | Installer is unsigned; this is not signed-release or multi-version support evidence |
| Data directory / migrations / restart | Isolated `NB_DATA_DIR`, packaged launch, persisted SQLite snapshots and restart | Approved by local test | Not equivalent to uninstall/reinstall preservation |
| Uninstall / data preservation | Uninstaller `/S` returned 0, removed `.release-test-install-2`, and left the isolated `.release-test-data-2` directory present | Approved for isolated uninstall/data preservation | Real `%APPDATA%` was not touched; generated test data remains pending cleanup |
| Real Claude/Codex task | CLI binaries detected, but auth and real task execution intentionally not queried | Blocked by authorization | No credential use without explicit approval |
| Real TFS/Azure DevOps read-only | No corporate endpoint or credential used | Blocked by external access | Local fake server only |
| TFS/Azure DevOps write approval | Local fake server, typed IPC, explicit native confirmation, no write before approval | Approved by simulated test 3/3 | Not a real integration approval |
| Extensions absent / Core independence | Fresh isolated data directory contains neither `neura` nor `velix`; Core remains usable | Approved by simulated test 3/3 | Does not prove package availability on a signed production installer |
| Extension incompatibility | Local manifest requiring Core `99.0.0` rejected before activation | Approved by simulated test 3/3 | Local manifest fixture |
| Extension update data preservation | Marker payload present in v1 and v2 staging after update, with v1 restored by rollback | Approved by simulated test 3/3 | Does not prove user-data migration across uninstall |
| YouTube / Spotify / VoiceStudio / FFmpeg | No real service/provider run | Not executed | Availability and credentials not established |
| Security redaction | Task/evidence/diagnostic redaction suites and packaged diagnostics export | Approved by local/simulated tests | Real provider logs were not collected |

## Evidence and commands

| Evidence | Result |
|---|---|
| `npx playwright test tests/e2e/azure-devops.spec.ts tests/e2e/extensions.spec.ts --workers=1` | 5/5 passed, repeated 3 times (15/15) |
| `npx playwright test tests/e2e/primary-journey.spec.ts --workers=1` | 13/13 passed against packaged Electron |
| `npx vitest run ... --no-file-parallelism` | 60/60 directed tests passed |
| Installer distribution verification | `npm run verify:dist` passed; installer SHA-256 recorded by command output |
| Authenticode verification | blocked: `signtool.exe` unavailable |

The local TFS fixture covers read-only project, repository, board, pull request,
iteration and work-item reads. Its write scenario prepares a comment and only
publishes after the explicit native confirmation. It is labeled simulated and
does not prove corporate TFS compatibility.

Command: `npx playwright test tests/e2e/primary-journey.spec.ts --workers=1` (13/13 passed).

## Real-environment run — 2026-11-08

Executed on the same workstation (Windows 11 Pro build 26300 x64) with the user's explicit approval to use
their logged-in CLIs. Results are separated into code failures (fixed here) and external blockers.

| Scenario | Evidence | Result | Classification |
|---|---|---|---|
| Real CLI detection without login | `NB_REAL_CLI=1` `agents-real.spec.ts` (real Claude/Codex binaries, isolated empty config) | Passed 1/1 | Real |
| Real MCP registration in Claude Code and Codex | `NB_REAL_CLI=1` `mcp-real.spec.ts` (writes only to isolated config dirs) | Passed 2/2 | Real |
| AI Code Review with a real provider | `NB_REAL_CLI=1 NB_REAL_AGENT=claude` `git-review-real.spec.ts`, temp repo, patch applied only after approval, no commit | Passed 1/1 (Claude) | Real |
| Smart Commit with a real provider | `NB_REAL_CLI=1 NB_REAL_AGENT=claude` `git-smart-commit-real.spec.ts`, temp repo, no commit, working tree untouched | Passed 1/1 (Claude) | Real |
| Same two flows with Codex | First run with Codex | Failed: provider returned "usage limit" (resets 2026-11-09 21:21) | **External blocker** (provider quota) |
| Collaborative chat (Claude plans, Codex implements) | `NB_REAL_CLI=1` `chat-real.spec.ts` | Failed in the same run as the Codex usage limit | **External blocker** (Codex quota); rerun after reset |
| Real TFS read-only with the saved connection | App opened on an isolated copy of the user's data (connection is read-only); probe and reads | Every endpoint answered `401 Unauthorized`; re-login attempt not possible because the TFS server was reported down | **External blocker** (expired credential + TFS outage) |
| Real TFS write with approval | Not attempted (user chose read-only; saved connection is read-only) | Not executed | Out of scope by user decision |
| Other Windows versions / clean profile on another machine | Only this workstation is available | Not executed | **External blocker** (no other environment) |

### Code failures found and fixed in this run

| Defect | Fix | Evidence |
|---|---|---|
| TFS probe reported `connected` with every capability `false` when every endpoint returned 401 (`capabilities()` used `allSettled` and never failed) | The probe now fails with the translated reason (`login_required`, `forbidden`, ...) and the connection status is stored as such | `azure-devops-client.test.ts` 16/16 (2 new red→green tests); rerun against the real server stored `login_required` |
| `git-review-real.spec.ts` targeted the review panel without opening the "Revisão IA" tab added to the Git workspace | Test opens the tab first | Passed against the real provider |
| Real Git specs could only use Codex | `NB_REAL_AGENT=claude` selects Claude Code (same convention as `skills-real`) | Both passed with Claude |

The user's real data directory was never opened by the test app: the TFS check ran on a temporary copy,
which was deleted afterwards. No commit, push or TFS write was made.
