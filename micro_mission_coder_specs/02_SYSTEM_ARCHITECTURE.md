# 02 — System Architecture

## High-level architecture

```text
User prompt/spec
  ↓
Spec Brain
  ↓
Mission Brain
  ↓
Task Graph
  ↓
Hardware Governor
  ↓
Task Scheduler
  ↓
Repo Brain freshness gate
  ↓
Context Governor
  ↓
Model Orchestrator
  ↓
Patch Harness
  ↓
Verifier
  ↓
Confidence Engine
  ↓
Mission Ledger update
  ↓
Continue / ask / escalate / finish
```

## Persistent services

### Mission Brain

Stores long-horizon state outside model context.

### Spec Brain

Turns rough goals or spec sheets into executable, verifiable tasks.

### Repo Brain

Builds and maintains semantic repository intelligence.

### Docs Brain

Provides version-aware documentation and repo-local examples.

### Design Brain

Provides frontend design constraints, UI states, component rules, visual baselines, and selected Open Design/shadcn/chatcn guidance.


### Open Design Adapter

Optional Design Brain adapter that indexes selected Open Design Skills, Design Systems, and templates. It must compile them into small DesignPacketV2 excerpts. It must not expose Open Design as a broad tool/plugin catalog to the model.

### shadcn/ui and chatcn policy

shadcn/ui is the default component foundation only when compatible with the target stack and not superseded by existing repo components. chatcn is an optional source for chat/agent-conversation UI surfaces built on shadcn/ui.


## Runtime governors

### Context Governor

Builds small PhasePackets for each model call.

### Hardware Governor

Controls model loading, context windows, browser checks, parallelism, and fallback policy.

### Model Orchestrator

Loads/unloads hot/warm/cold models and routes inference requests.

### Task Scheduler

Executes task DAG waves with file-lock and hardware constraints.

## Execution layer

### Patch Harness

Applies patches in isolated worktrees and rolls back failed changes.

### Verifier

Runs tests, typecheck, lint, Playwright, and other commands.

### Confidence Engine

Converts verifier and evidence signals into an accept/retry/escalate decision.

### Trace Store

Records everything for debugging, evaluation, and future training.

## Model roles

| Role | Required in MVP | Purpose |
|---|---:|---|
| Spec critic | Yes | Detect ambiguity and missing criteria |
| Planner/controller | Yes | Choose next action and route phase |
| Code writer | Yes | Generate patches |
| Test writer | Later | Generate tests separately from code writer |
| Bug analyst | Later | Generate hypotheses from failures |
| Reviewer/veto | Later | Check patch scope/risk |
| Docs summarizer | Later | Compress retrieved docs |
| Design critic | Later | Check frontend work against design rules |
| VLM | Later | Visual inspection after Playwright artifacts exist |

## Core data flow

### Mission cycle

```text
1. Load current mission state.
2. Select next unblocked task.
3. Verify Repo Brain freshness.
4. Generate EvidencePacket.
5. Generate PhasePacket.
6. Call planner/coder.
7. Apply patch.
8. Verify.
9. Update mission state.
10. Decide next step.
```

### Freshness contract

```text
If Repo Brain freshness != fresh:
  block execution
  refresh index
  regenerate evidence
  resume task
```

### Context contract

```text
No model receives broad repo access.
No model receives a global tool catalog.
No model gets stale evidence.
No code patch may reference files outside allowed_files unless it requests more evidence first.
```

## Recommended initial implementation layout

```text
src/
  cli/
  core/
    mission/
    spec/
    repo-brain/
    docs-brain/
    design-brain/
    context/
    hardware/
    scheduler/
    models/
    harness/
    verifier/
    confidence/
    trace/
  adapters/
    tree-sitter/
    lsp/
    ollama/
    llamacpp/
    vllm/
    playwright/
  schemas/
  prompts/
```

## Internal protocol rule

Use minimal internal JSON contracts. Do not expose all tools to models. Each model call gets only the actions relevant to its phase.

Example:

```json
{
  "phase": "code_patch",
  "allowed_actions": ["emit_unified_diff", "request_more_evidence", "decline"],
  "allowed_files": ["src/components/InvoiceTable.tsx"],
  "budget_tokens": 3200
}
```
