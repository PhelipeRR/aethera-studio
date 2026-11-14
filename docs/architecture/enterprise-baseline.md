# Enterprise consolidation baseline — 2026-11-05

## Scope and change control

This baseline was captured before the consolidation work. The worktree already
contained user changes across Velix, TFS/Azure DevOps, Neura, the desktop main
process, the database and documentation. Those changes are preserved; no
cleanup or deletion is authorized by this baseline.

## Product classification

| Area | Classification | Release implication |
|---|---|---|
| Chat, TaskEngine, Projects, permissions, approvals, evidence, recovery | core | release-critical |
| Neural Brain, Git, Workflows, MCP, Analytics | power tool | validate after core |
| TFS/Azure DevOps, YouTube, Spotify, VoiceStudio, FFmpeg | integration | experimental until homologated |
| Neura and Velix | extension candidate | freeze new capability work until core gates |

## Inventory

- Tracked source, migrations, tests and historical plans are retained.
- Generated/temporary material observed: `.debug-data/`, `.motion-runtime/`,
  `tmp-motion-test.mp4`, `artifacts/` and RAG test directories.
- No artifact was deleted. Each generated item requires a reference scan and a
  reproducible replacement before any future cleanup.

## Release-critical matrix

1. `npm run typecheck`
2. focused shared/database/orchestrator Vitest for TaskEngine, migrations and evidence
3. `npm run lint` for touched files
4. packaged Electron primary journey E2E: request → approval → execution → evidence → restart/recovery
5. distribution verification, when packaging is available

At capture time, the full baseline commands were not rerun over the entire
dirty worktree; their result must be recorded in `docs/STATUS.md` as each gate
is executed. Environment-dependent real-provider and TFS write checks remain
external and require explicit approval.
