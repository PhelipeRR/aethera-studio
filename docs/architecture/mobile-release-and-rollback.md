# MOB-03 — distribuição interna e rollback

## Release boundary

The first artifact is an Android Expo development build distributed internally. iOS remains a later matrix entry. No
public store, Tailscale Funnel, push provider or production signing credential is introduced by this phase.

Before a device build is promoted, run the following matrix against a disposable paired device and a Core in
`tailscale serve` mode:

| Scenario | Expected result |
| --- | --- |
| Cold start with valid session | Core health and real task list load; no placeholder task is shown. |
| Expired access token | One refresh rotation is attempted; the new pair is stored only after success. |
| Reused refresh token | Session is cleared and the user must pair again. |
| Tailnet unavailable | Read screen shows unavailable; commands are not queued or replayed. |
| Desktop revokes device | Open stream/session is invalidated and local tokens are removed. |
| Background/foreground | On foreground, perform a bounded health/read refresh; do not run an executor in background. |
| Push payload | Only `pushNotificationSchema` metadata is accepted; task body and memory content are rejected. |
| Rotation and accessibility | Portrait Android layout, large text, screen reader labels and reduced motion remain usable. |

## Rollback

1. Stop internal distribution of the mobile artifact.
2. Revoke the affected device ids from Desktop → Dispositivos e acesso remoto.
3. Remove the app or clear its SecureStore data; do not delete Core data or run a database migration.
4. If an app version is incompatible with the Core API, reinstall the previous internal artifact. The Core remains on its
   existing version because the mobile client is an additive consumer.

Rollback is therefore reversible and local to the device/session. No desktop runtime, TaskEngine, MCP, RAG index or
credential store is changed.
