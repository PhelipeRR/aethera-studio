# Extension distribution and updates

Neura and Velix are independent versioned packages under `packages/extensions-neura` and `packages/extensions-velix`. Each has an `extension.json` manifest. Core validates schema, minimum Core version, checksum, signature value, permissions and package paths before activation.

Local installation copies a directory containing `extension.json` into `%APPDATA%\NeuralBridge\extensions\<id>\<version>` through an isolated staging directory. Symlinks/junctions, absolute paths, `..` escapes, malformed manifests, invalid checksums/signatures and incompatible Core versions are rejected before activation.

Installed state is persisted in SQLite. Enable/disable changes state without deleting files. Updates retain the previous manifest for rollback; failed validation or staging leaves the active version untouched. Uninstall removes only the extension's own directory and registry row. Neura and Velix remain available through their existing routes.

The UI must display name, version, minimum Core, requested permissions, checksum/signature status and update channel before installation. A permission increase requires a new approval. Manifest text and extension output are untrusted data and do not grant filesystem, network, Git, credential or task permissions.

The local `sha256` signature is an integrity/development mechanism, not asymmetric publisher authentication. A remote registry must add publisher signatures, key rotation/revocation and pinned HTTPS before remote distribution is enabled. No automatic remote download is currently configured.

| Extension | Version | Minimum Core | OS | Dependencies | Channel |
| --- | --- | --- | --- | --- | --- |
| Neura | 1.0.0 | 0.1.0 | Windows desktop | Neura runtime/providers | local |
| Velix | 1.0.0 | 0.1.0 | Windows desktop | Motion/FFmpeg/VoiceStudio as configured | local |

Validation covers malformed manifests, invalid signatures/checksums, Core incompatibility, traversal, symlinks, staging, update, rollback, disable/enable, persistence and uninstall.
