# Module call graph and technical-debt audit

Audit date: 2026-11-06. This document is a read-only structural audit. No
source, route or IPC channel was removed.

## Method and evidence

The audit used `rg --files`, `rg` symbol/reference searches, package
`exports`/dependency manifests, the TypeScript barrel files, the Electron
preload surface, the route table, and the existing unit/integration/Electron
tests. Static absence is not treated as proof of dead code: dynamic imports,
Electron startup registration, route tables, preload indirection and tests
were checked before assigning confidence.

The current IPC surface contains 393 declared invoke channels and 393 matching
contract entries. All 393 channel names have references in both
`apps/desktop/src/preload/index.ts` and the main-process registration set.
`registerIpcHandler` covers the ordinary handlers; the five Companion
subscription/query channels are registered by `companion-ipc.ts` and still use
the same input/output parsers. This is a static graph, not proof that every
screen path has runtime coverage.

## Module inventory

| Module | Entry points | Consumers / dependencies | Public exports | IPC / routes / tests | Possible dead code / pass-through | Coupling, deep-module opportunity, priority |
|---|---|---|---|---|---|---|
| `packages/shared` | `src/index.ts`, explicit subpath exports | Every package and desktop layer; Zod | Broad domain, IPC channel/contract, task, project, Brain, Velix, extension and diagnostic contracts | All IPC contracts; every desktop route consumes a domain contract; extensive `packages/shared/test` | `src/index.ts` is an intentional barrel. Generated brand-font map is consumed by brand-piece code. No dead export proven. | Highest fan-out. Split future contracts by bounded domain without breaking subpaths. P1. |
| `packages/database` | `src/index.ts`, `open.ts` | Brain, orchestrator and Electron main; shared types, Drizzle, SQLite | Schema, migrations adapter, backup and domain repositories | Main handlers for projects/Brain/Velix/TFS/extensions; repository/database tests | `index.ts` is a pass-through barrel by design. Repository families are used through services and handlers. | Persistence boundary is strong but broad schema is coupled to all feature waves. Introduce narrower repository ports. P1. |
| `packages/brain` | `src/index.ts`, `BrainService`, embedding/indexing modules | Electron main and standalone MCP; database/shared, Transformers | Brain service, RAG/search, embeddings, learning, history, secrets, settings, Git index | Brain/memory routes; Brain IPC handlers; Brain unit tests and MCP tests | `history-import.ts` is invoked during Electron startup; no dead finding. Barrel is pass-through. | Search/indexing and history sync share runtime concerns. Separate deep search/indexing services over time. P1. |
| `packages/orchestrator` | `src/index.ts`, TaskEngine and domain services | Electron main; agents, workspace, database, shared | TaskEngine, application service, evidence, workflows, Neura, Velix, integrations, extensions, diagnostics | Tasks, workflows, mission-control, video, Neura, extensions and TFS handlers; broad orchestrator tests | `extensions/extension-updater.ts` is a thin adapter and has no production consumer beyond export; possible dead/pass-through, confidence medium. | Very high domain fan-out. `main/index.ts` and orchestrator imports form the main coupling hotspot. Extract stable application ports. P0/P1. |
| `packages/workspace` | `src/index.ts`, project/Git/skills/Velix services | Electron main and orchestrator; shared | Project discovery/files, Git, skills, MCP registration, Velix/video services | Projects, Skills, Git Intelligence, Velix routes; workspace tests | Index barrel is intentional. Velix modules are active through main handlers and tests, not dead by filename. | Core workspace and audiovisual feature set are co-located. Split future deep modules by project/Git/skills/video ports. P1. |
| `packages/agents` | `src/index.ts`, Claude/Codex adapters | Orchestrator and Electron main; shared/workspace | Agent contracts, adapters, parsers, process runner, redaction | Chat/Agents routes and task handlers; adapter/parser/redaction tests | Parser fixtures and fake CLI are test consumers. No dead production module proven. | Small cohesive boundary; keep provider-specific parsing behind adapter ports. P2. |
| `packages/mcp-server` | `src/cli.ts`, `src/server.ts`, package index | Standalone Electron-run-as-node process; Brain/database/shared/MCP SDK | MCP server, scope resolution and task tools | No renderer route; MCP route shows status/configuration; server/scope tests | `index.ts` is a public barrel. CLI is a process entry point, not dead despite limited imports. | Correctly isolated protocol boundary; avoid importing desktop main into it. P2. |
| `apps/desktop/src/main` | Electron `index.ts`, startup/window and handler modules | Electron runtime; all packages and OS providers | Runtime composition, IPC handlers, services, stores and security setup | All routes indirectly; all 393 invoke channels; main-specific tests plus Electron E2E | `index.ts` is a composition root, not dead, but is oversized. Existing `git-ipc`, `companion-ipc`, `neura-ipc` are extracted handler seams. | Critical coupling hotspot: composition, policy, persistence and provider calls coexist. Extract one domain handler/service at a time. P0. |
| `apps/desktop/src/preload` | `index.ts`, `contextBridge.exposeInMainWorld` | Renderer and Electron IPC; shared channel types | `NeuralBridgeApi`, a typed capability facade | All 393 invoke channels plus event subscriptions; renderer and E2E consume `window.neuralbridge` | The facade is intentionally pass-through/security-boundary code. Unused methods cannot be judged from channel references alone because route/test indirection is valid. | Large API surface and payload forwarding create change coupling. Generate/partition API by domain only with compatibility tests. P1. |
| `apps/desktop/src/renderer/src` | `main.tsx`, `routes.ts`, `AppShell` | Preload API and shared types; React | Routes, pages, feature hooks/components and UI primitives | 17 route entries, extension-gated Velix route, all feature screens; component/unit/E2E tests | `PlannedPage` is a live intentional route fallback. Components without direct route imports need route and lazy-load checks before classification. | UI has broad access to the single preload facade. Deep modules are domain hooks (`brain`, `projects`, `video`, `tasks`) already emerging; continue by feature, not global rewrites. P1. |

## Prioritized small refactors

1. P0: extract one handler group from `apps/desktop/src/main/index.ts` behind a
   typed service port, starting with the largest audiovisual group; retain the
   same channel registrations and run the existing E2E tests.
2. P1: add a generated or tested domain inventory for preload methods so a
   channel contract, preload method and renderer consumer can be compared
   without relying on string searches.
3. P1: define narrower orchestrator application ports for TaskEngine,
   extension lifecycle and Velix production rather than exposing the entire
   barrel to main.
4. P1: measure and, where appropriate, stream or cap large IPC payloads such
   as generated media and render data; do not change limits without product
   compatibility evidence.
5. P2: decide whether `createExtensionUpdater` should become the sole update
   seam or remain an explicit future contract; do not delete it during this
   audit.

## Do-not-remove list

Do not remove migrations, database schema/repositories, history import, route
fallbacks, preload facade methods, IPC contracts, test fixtures/snapshots,
generated font assets, MCP CLI entry points, or extension adapters based only on
low direct-import counts.
