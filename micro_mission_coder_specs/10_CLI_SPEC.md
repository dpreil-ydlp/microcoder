# 10 — CLI Spec

Binary name: `mmc`

## Commands

### `mmc init`

Initializes project.

Creates:

- `.mission/`
- `.micro-mission-coder.yaml`
- SQLite DB
- initial Mission Ledger files

### `mmc doctor`

Reports environment:

- RAM/CPU/GPU estimate
- detected hardware profile
- git status
- model provider availability
- Node/version/tools availability

### `mmc spec create "<goal>"`

Creates draft spec from rough goal.

### `mmc spec compile [file]`

Compiles spec and reports blocking questions or task graph.

### `mmc mission start [spec]`

Creates active mission from compiled spec.

### `mmc repo index`

Indexes repository and writes Repo Brain state.

### `mmc repo status`

Prints Repo Brain freshness.

### `mmc task next`

Prints next runnable task.

### `mmc run --task T4`

Runs one task through context, model, patch, verify, confidence.

### `mmc run --mission`

Runs mission until blocked, complete, or hardware policy stops execution.

### `mmc verify --task T4`

Re-runs verification for a task.

### `mmc attempts list --task T4`

Shows attempts.

### `mmc artifacts list --attempt A9`

Shows artifacts.

### `mmc config profile middle_32gb`

Sets hardware profile.

## Exit codes

- 0 success
- 1 validation error
- 2 blocked by spec ambiguity
- 3 Repo Brain stale/failed
- 4 patch failed
- 5 verification failed
- 6 hardware policy blocked
- 7 model provider failed
