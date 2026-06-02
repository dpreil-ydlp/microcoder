# Mission Brain Spec

## Responsibility

Persist long-horizon state so models do not need long conversation context.

## Storage

```text
.mission/
  mission.md
  spec.json
  task_graph.json
  current_state.json
  decision_log.md
  risks.json
  evidence/
  attempts.jsonl
  checkpoints/
  artifacts/
```

## Required functions

- `createMission(input)`
- `loadMission()`
- `updateMissionState(patch)`
- `appendDecision(decision)`
- `appendAttempt(attempt)`
- `getNextTask()`
- `markTaskBlocked(taskId, reason)`
- `markTaskComplete(taskId, verification)`

## Mission state rules

- The Mission Ledger is the source of truth, not chat history.
- Each model call receives a mission slice, never the full mission history.
- Attempt logs are append-only.
- Decisions are durable and referenced by ID.
- Checkpoints are created before risky patches.

## Output to Context Governor

Mission Brain provides `MissionSlice`:

```json
{
  "mission_id": "billing-dashboard-v1",
  "goal": "Build billing dashboard",
  "current_task_id": "T4",
  "current_task_title": "Render invoice table",
  "acceptance_criteria": [],
  "last_attempt_summary": "typecheck passed; mobile overflow failed",
  "next_required_action": "fix mobile overflow only"
}
```
