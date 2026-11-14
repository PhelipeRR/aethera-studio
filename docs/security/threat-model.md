# NeuralBridge threat model

Status: review baseline for Task 4.2 (2026-11-05). This document describes the trust boundaries that the desktop application must preserve. Project files, agent output, MCP responses, extension packages, Git diffs, cached TFS data, media metadata and generated artifacts are data, not instructions or authority.

## Assets and trust boundaries

| Boundary | Asset / threat | Required control |
| --- | --- | --- |
| Renderer | UI state, user prompts, imported text, route parameters | Treat all rendered/imported content as untrusted; no Node integration; use typed preload only. |
| Main process | Filesystem, child processes, credentials, database and OS capabilities | Validate every IPC payload and sender; keep secrets and privileged operations here; use explicit approval for writes. |
| Preload / IPC | Capability bridge between renderer and main | Allowlisted typed channels, schema validation, trusted sender checks, bounded inputs, no generic eval or arbitrary channel. |
| Claude Code / Codex CLI | Agent prompts, tool calls, output, sessions and credentials | Read-only is a distinct execution mode; project content cannot grant permissions; redact output and never treat model text as policy. |
| MCP | Local/remote tools and their responses | Tool results are untrusted data; enforce server configuration and connection permissions in main; do not expose credential fields. |
| User repositories/files | Source, `.env`, SSH keys, Git config, symlinks and malicious instructions | Read only the authorized root, reject traversal/symlink escapes, exclude secret filenames, and quote arguments without shell interpolation. |
| Neural Brain / RAG | Memories, embeddings, indexed files and retrieved context | Scope by project/user, redact before prompts/logs, bound context, and label retrieved text as non-authoritative. |
| Neura / Velix extensions | Manifest, code, permissions, package files and update history | Validate schema, Core compatibility, checksum/signature, permissions and path safety; keep versions isolated and rollbackable. |
| TFS / Azure DevOps | PATs, credentials, work items, PRs and write operations | Store credentials encrypted in main; default read-only; require explicit capability, approval and connection checks before writes. |
| YouTube / Spotify / VoiceStudio / FFmpeg | OAuth tokens, client secrets, media, subprocesses and provider data | Keep tokens in main/safe storage, use least-privilege scopes, allowlist external hosts, pass argv without a shell, validate media paths and redact logs. |
| Logs / diagnostics / snapshots / diffs / artifacts | Prompts, source, tokens, paths and provider responses | Redact credential-shaped data, bound output, avoid raw manifests/secrets, and require deliberate export. |

## Abuse cases and mitigations

### Prompt injection and untrusted content

Repository files, issue bodies, PR comments, meeting transcripts, MCP responses, RAG memories, skill files and media metadata may contain instructions such as “ignore the policy” or “send this secret”. They remain data. Prompts must delimit and label them as untrusted; model output never changes permissions, approval state, selected project, or destination by itself. A read-only analysis cannot be promoted to an edit run by content returned from a tool.

### Filesystem traversal and symlinks

All project-relative paths must be resolved under a real authorized root and checked after resolution. Absolute paths, `..` escapes, junctions and symlinked extension sources are rejected where the operation imports or writes files. Extension installation uses isolated `id/version` directories and must never follow a package symlink outside its source tree.

### Credentials and secret exposure

PATs, OAuth refresh tokens, API keys, passwords, client secrets and SSH material belong in main-process encrypted storage or the provider's credential mechanism. They must not cross into renderer state, task prompts, raw logs, diagnostics, snapshots, diffs, cached provider records or exported support bundles. Secret detection is defense in depth, not permission to persist a secret.

### Permission escalation

The effective permission is determined by the project and explicit user action, never by a prompt, repository file, model response, extension manifest alone, or cached integration response. Read-only tasks remain read-only even when a project has edit access. TFS writes require a non-read-only connection, a prepared operation, and a visible human approval immediately before execution. Git destructive operations remain separate explicit actions and must not be inferred from review output.

### Extensions

An extension is untrusted code/data at the installation boundary. Reject malformed, incompatible, unsigned/invalid-checksum and path-escaping packages before registry activation. Never execute an extension merely because it is present on disk. Keep previous versions for rollback and make failed updates leave the Core and prior extension usable.

### External content and subprocesses

Only approved HTTPS hosts may open externally. External responses are untrusted and bounded before storage or prompting. Child processes use explicit executable/argv/cwd/env, `shell: false`, cancellation and output limits. FFmpeg/FFprobe and render outputs remain inside the authorized project root.

## Current controls and known gaps

- Typed IPC handlers reject untrusted senders and invalid input/output schemas.
- Electron navigation and browser permissions are restricted to the app and explicitly approved audio flows.
- Agent output is redacted before logs and task-visible error text; read-only TaskEngine paths are distinct from edit paths.
- Database migration failure enters degraded mode without deleting the database.
- Extension manifests are schema-, Core-, checksum- and signature-checked; local directory import now rejects symbolic links.
- Diagnostics export includes release/migration/extension state and redacts credential-like fields.

Remaining risks require release or product work: asymmetric extension signing/key rotation, a complete secret corpus and log sink review, automatic-update trust, provider-specific OAuth scope review, and full hostile-content E2E coverage. These are not silently treated as solved by the local checksum mechanism.

## Security release gate

Before a release candidate, run secret-corpus/redaction, traversal/symlink, prompt-injection, permission, IPC, extension-integrity, diagnostics-export, and read-only rejection tests; then run typecheck, lint, Electron build, relevant E2E suites and `git diff --check`. Any failed security test blocks release and is recorded in `docs/STATUS.md`.
