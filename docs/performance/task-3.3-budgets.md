# Task 3.3 — Performance budgets

The renderer budgets are intentionally conservative for the current Windows
desktop baseline and are enforced by `tests/e2e/performance-density.spec.ts`:

| Measurement | Budget | Probe |
| --- | ---: | --- |
| Electron startup to first usable window | < 10 s | `launchApp()` plus first window readiness |
| Transition to a lazy Analytics route | < 3 s | hash navigation to `/analytics` and heading readiness |
| Initial renderer bundle | heavy routes split | Electron build output contains dedicated Analytics, Brain 3D, Graph and Velix chunks |

The probe runs against the local Windows CI-equivalent environment. These are
release guardrails, not universal hardware claims; a future release pass should
repeat them on the slowest supported machine and tighten the thresholds from
observed p95 values.
