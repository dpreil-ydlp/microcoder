# Task Scheduler Spec

## Responsibility

Execute mission task graphs under dependency, file-lock, and hardware constraints.

## Required functions

- `selectNextTask()`
- `computeExecutionWave()`
- `lockFiles(taskId, files)`
- `releaseFiles(taskId)`
- `canRunInParallel(taskA, taskB)`
- `schedule(taskGraph, hardwareProfile)`
- `pauseForMachinePressure()`

## Parallelism rules

Allowed in parallel:

- Repo Brain refresh
- docs retrieval
- static analysis
- test discovery
- model warmup
- independent planning

Usually forbidden in middle mode:

- two heavy code generations
- overlapping file edits
- VLM during heavy codegen
- full test suite while model is decoding

## Worktree rules

Parallel implementation tasks must use separate worktrees and merge only after verification.
