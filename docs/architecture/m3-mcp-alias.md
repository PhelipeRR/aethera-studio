# M3 — Alias MCP `singularity`

The MCP migration is additive. The existing `neuralbridge` registration remains the compatibility path; the MCP page now
offers an explicit action to add `singularity` beside it for the transition window. The workspace registration helper
accepts a server name, checks the named registration, backs up the client configuration and adds only that alias.

Rollback is the existing unregister action for `singularity`; it never removes `neuralbridge`. No package name, MCP server
implementation name, data path or credential was changed.

Validated with workspace registration tests, shared IPC tests, typecheck and lint.
