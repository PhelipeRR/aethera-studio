# Extension security boundary

The Core treats Neura and Velix as untrusted, independently versioned packages. Installation is staged under `<install-root>/<id>/<version>`, validated before registry state changes, and removed without touching `<id>/user-data*`.

## Controls implemented

- Versioned, strict manifest schema with constrained extension IDs, SemVer, capabilities, permissions, entrypoints, checksum and signature contract.
- Core compatibility and duplicate/downgrade checks.
- SHA-256 payload verification, file-count and 10 MiB package limits.
- Absolute paths, traversal, backslash separators, duplicate paths, symlinks and undeclared files are rejected.
- Atomic staging plus cleanup on failed activation; a failed update never replaces the registry entry.
- Persisted enabled/disabled state and previous manifest support rollback after restart.
- Capability checks are explicit contracts; extension code cannot claim a capability absent from its manifest.
- Diagnostics must expose IDs, versions and state only; payloads, signatures and user data are not logged.

## Deliberate boundaries

HTTPS registry discovery, asymmetric signature verification, automatic update scheduling and Authenticode remain integration contracts, not local trust decisions. They are tracked as external release blockers in the release decision.

## Threats covered by tests

Corrupt checksums, incompatible Core versions, traversal, symlinked sources, undeclared files, oversized payloads, interrupted/failed activation cleanup, downgrade attempts, restart persistence and user-data-preserving removal.
