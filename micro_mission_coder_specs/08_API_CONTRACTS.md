# 08 — API Contracts

## Internal API principle

Use narrow internal APIs. Do not expose general tool catalogs to models.

## Repo Brain API

### `GET /repo/status`

Returns index status.

```json
{
  "status": "fresh",
  "repo_sha": "abc123",
  "index_sha": "idx456",
  "dirty_files": []
}
```

### `POST /repo/refresh`

Refreshes stale index areas.

```json
{
  "paths": ["src/components/InvoiceTable.tsx"],
  "mode": "incremental"
}
```

### `POST /repo/evidence`

Builds evidence packet for a task.

```json
{
  "task_id": "T4",
  "budget_tokens": 2000,
  "include_tests": true,
  "include_docs_hints": true
}
```

## Spec Brain API

### `POST /spec/compile`

```json
{
  "input_type": "markdown",
  "content": "..."
}
```

Response:

```json
{
  "status": "compiled",
  "spec": {},
  "blocking_questions": [],
  "task_graph": {}
}
```

## Context Governor API

### `POST /context/phase-packet`

```json
{
  "phase": "code_patch",
  "task_id": "T4",
  "hardware_profile": "middle_32gb",
  "model_id": "qwen2.5-coder-7b-q4"
}
```

## Model Orchestrator API

### `POST /model/generate`

```json
{
  "role": "code_writer",
  "model_id": "qwen2.5-coder-7b-q4",
  "phase_packet": {},
  "temperature": 0.1,
  "max_tokens": 1200
}
```

## Patch Harness API

### `POST /harness/apply-patch`

```json
{
  "task_id": "T4",
  "attempt_id": "A9",
  "patch": "--- a/file.tsx...",
  "allowed_files": ["src/components/InvoiceTable.tsx"]
}
```

### `POST /harness/verify`

```json
{
  "task_id": "T4",
  "commands": ["pnpm typecheck", "pnpm test invoice"]
}
```

## Confidence API

### `POST /confidence/score`

```json
{
  "task_id": "T4",
  "attempt_id": "A9",
  "verification_results": [],
  "risk_flags": [],
  "patch_scope": {}
}
```

## Design Brain APIs — Open Design/shadcn/chatcn

```ts
interface DesignBrainApi {
  buildDesignPacketV2(taskId: string, budget: TokenBudget): Promise<DesignPacketV2>;
  selectOpenDesignAssets(taskId: string, budget: TokenBudget): Promise<OpenDesignSelection>;
  classifyUiSurface(taskId: string): Promise<UiSurface>;
  selectComponentLibrary(taskId: string): Promise<ComponentLibrarySelection>;
}
```

Rules:

- `buildDesignPacketV2` is required for all frontend tasks.
- `selectOpenDesignAssets` is optional and must respect hardware/context budgets.
- Open Design catalogs must be indexed outside model context.
- chatcn may be selected only for chat/agent-conversation UI surfaces.
