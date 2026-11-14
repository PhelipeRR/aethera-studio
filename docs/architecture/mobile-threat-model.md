# MOB-01 — Companion Mobile: threat model and rollback

## Boundary

The Android-first Expo app is a remote client, not an executor. It calls the versioned Core API over a private Tailscale HTTPS endpoint. The Singularity Core remains the only component that creates, runs, persists, cancels, and recovers tasks.

The app stores only access-token, refresh-token, and device-id material in the platform secure store. The device private key and DPoP signer remain on the device; the public JWK is the only key material sent during pairing. No SQLite, MCP, CLI, or desktop IPC is bundled into the mobile target.

## Threats and controls

| Threat | Control |
| --- | --- |
| Public exposure of the Core | The client accepts only HTTPS `*.ts.net` endpoints; Tailscale Funnel is not part of the design. |
| Stolen bearer material | Access is DPoP-bound; refresh tokens rotate and reuse revokes the family. |
| Replay | Per-request DPoP proof carries method, URL, time, token hash, and a unique id. |
| Over-privileged phone | Grants are issued by the Desktop and default to `read` + `chat`; local/elevated scopes stay unavailable remotely. |
| Duplicate execution | Mobile only calls Core command routes; no executor or TaskEngine is shipped in the app. |
| Lost phone | Desktop revocation invalidates all device tokens and closes streams. |
| Data leakage in push | Future push payloads are metadata-only; task bodies and memory contents stay in the Core. |

## Rollback

MOB-01 is additive and isolated under `apps/mobile`. Rollback is removal of the mobile build/distribution artifact and revocation of paired device ids. It does not require a database migration or a Core rollback. The Desktop and existing remote contracts remain unchanged.

## Current limitations

MOB-01 provides the Expo shell, P-256/DPoP identity and Core client contracts. MOB-02 adds Core-session refresh rotation, task approval/continuation, metadata-only push validation and hybrid memory search. QR camera capture, a concrete push provider, background delivery and a production development build remain MOB-03 work. The current UI never invents task, memory, pairing or notification data.
