# Extension hardening matrix

| Scenario | Control | Evidence |
|---|---|---|
| Invalid manifest / unknown field | strict versioned schema | shared/orchestrator extension tests |
| Core mismatch, duplicate, downgrade | compatibility and monotonic version gates | orchestrator extension tests; Electron E2E |
| Corrupt payload | SHA-256 checksum before activation | orchestrator extension tests |
| Traversal, absolute path, symlink | normalized paths and `lstat` rejection | orchestrator extension tests |
| Unexpected file / oversized package | manifest entrypoint allowlist and 10 MiB limit | orchestrator extension tests |
| Failed activation | staged payload cleanup and unchanged registry | orchestrator extension tests |
| Restart | SQLite state reload | orchestrator extension tests; Electron E2E |
| Removal | only version payloads removed; user data retained | orchestrator extension tests |
| Registry HTTPS / asymmetric signatures / auto-update | intentionally deferred integration contracts | release decision 0.1.58 |

The matrix is local-validation evidence, not an enterprise trust certification.
