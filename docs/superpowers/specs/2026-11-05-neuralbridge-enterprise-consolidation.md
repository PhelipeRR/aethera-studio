# NeuralBridge enterprise consolidation slices

This specification turns the consolidation plan into reviewable slices.

## Core slice (owner: TaskEngine/application services)

Acceptance: a task has a persisted snapshot with phase, attempt, checkpoint,
approval, cancellation, failure category, evidence references and recovery
action; restart and duplicate events do not repeat a side effect.

## Evidence slice (owner: orchestrator evidence service)

Acceptance: structured command/agent/files/tests/timing/output/artifact data is
stored with a correlation ID and credential-shaped values are redacted before
persistence or export.

## Recovery slice (owner: database/main process)

Acceptance: lock, corruption, migration, missing CLI and invalid configuration
produce actionable degraded state and preserve the last safe checkpoint.

## Architecture slice (owner: application services and IPC)

Acceptance: orchestration, approval, evidence, recovery and diagnostics have
injected seams for database, agent, filesystem and clock; renderer contracts
remain schema-validated and contain no credentials.

Neura/Velix capability work is frozen until these core acceptance gates pass.
