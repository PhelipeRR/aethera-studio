# Windows release checklist

## 0.1.58 decision status (2026-11-06)

0.1.58 is a local validation release candidate, not enterprise-ready. The
isolated install/uninstall smoke test passed and preserved its isolated data
directory. Authenticode, auto-update, valid previous-installer upgrade and
real-machine/provider homologation remain open. See
[`0.1.58-release-decision.md`](0.1.58-release-decision.md).

This checklist is the release record for the current desktop packaging path. It distinguishes local verification from checks that require the distribution environment.

## Artifact and version gates

- [ ] Confirm the intended version in the root and desktop `package.json` files.
- [ ] Run `npm run typecheck`, `npm run lint`, directed unit/integration tests, and relevant Playwright E2E suites.
- [ ] Run `npm run build`, `npm run dist:win`, and `npm run verify:dist`.
- [ ] Record the installer SHA-256 printed by `verify:dist`.
- [ ] Confirm the NSIS installer contains `app.asar`, migrations, MCP server, native SQLite binding, and the generated icon.

The local build is unsigned. A distribution build must provide `WIN_CSC_LINK` or `CSC_LINK`, then run `npm run verify:windows-signature -- <installer>` with Windows SDK `signtool.exe` before publication. No certificate, token, or fake signature belongs in this repository. Automatic update is not configured in this release path.

## Installation matrix

Use an isolated Windows VM for each row and record OS build, architecture, installer SHA-256, app version, and result.

| Scenario | Expected result |
| --- | --- |
| Clean install | NSIS installs without elevation, creates shortcuts, starts the app, and reaches the normal shell. |
| Install over previous release | The installer upgrades in place; `%APPDATA%\NeuralBridge` remains intact and the app opens the existing database. |
| Restart after upgrade | Migrations run before normal services; extension manifests and enabled/disabled state remain unchanged. |
| Failed migration simulation | The app enters its degraded/recovery path, preserves the database, and reports a safe failure; it never silently resets user data. |
| Uninstall | Binaries and shortcuts are removed; user data remains because `deleteAppDataOnUninstall` is `false`. |
| Unsupported downgrade | No automatic downgrade migration. Restore a compatible backup or reinstall a supported version while preserving the data directory. |

Before an upgrade, capture a reversible backup of `%APPDATA%\NeuralBridge`, including `db\brain.db` and extension data. Compare database row counts, migration state, and extension manifests after the upgrade.

## Extension and data compatibility

- [ ] Install Neura and Velix through the extension registry and confirm both continue to load during the transition.
- [ ] Confirm manifests, checksums/signatures, Core compatibility ranges, enabled/disabled state, and rollback metadata survive an upgrade.
- [ ] Confirm migrations are additive/reversible and uninstall does not remove the data directory.
- [ ] If migration fails, retain the original database and use degraded-mode diagnostics; do not mark the release valid until recovery is demonstrated.

## Diagnostics

Run `npm run diagnostics:export -- --data-dir <data-dir> --output <path>` and inspect the JSON before sharing it. The report contains schema version, app version, commit when available, platform, migration summary, extension IDs/versions/states, database presence/hash, and installer/update status. It must not contain tokens, cookies, passwords, API keys, authorization headers, private keys, or raw extension manifests.

## Release record

Record artifact path, SHA-256, command results, clean-install result, upgrade/data-preservation result, uninstall result, migration-failure result, signature result, and external blockers. A release is not complete while signing or real-machine validation is blocked.
