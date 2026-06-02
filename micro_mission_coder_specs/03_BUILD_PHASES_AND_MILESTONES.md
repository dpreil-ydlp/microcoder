# 03 — Build Phases and Milestones

## Phase 0 — Project skeleton

### Goal

Create the repository, CLI, configuration system, schema validation, storage layer, and test scaffolding.

### Deliverables

- CLI binary: `mmc`
- Config file loader
- SQLite database initialization
- `.mission/` directory creation
- JSON schema validation
- Basic trace logging
- Unit test setup

### Exit criteria

- `mmc init` creates a valid project structure.
- `mmc doctor` reports environment and hardware profile.
- All schemas validate example fixtures.

## Phase 1 — Mission + Spec runtime

### Goal

Implement mission creation, spec ingestion, spec compilation, task graph creation, and clarification blocking.

### Deliverables

- Mission Ledger
- Spec Compiler
- Clarification Gate
- Task DAG generation
- Mission state read/write

### Exit criteria

- Rough prompt can become a compiled spec.
- Missing acceptance criteria produce targeted questions.
- Valid spec produces task graph.

## Phase 2 — Repo Brain v1

### Goal

Create deterministic repository indexing with freshness gates.

### Deliverables

- File tree scanner
- Git SHA/index SHA tracking
- Tree-sitter parser adapter
- Basic symbol extraction
- ripgrep-backed fallback inside Repo Brain
- Test discovery
- Staleness detection

### Exit criteria

- Repo Brain can index a TypeScript project.
- Changing a file marks related evidence stale.
- Code generation blocks while index is stale.

## Phase 3 — Context Governor + Model Orchestrator

### Goal

Generate budgeted context packets and route local model calls through provider adapters.

### Deliverables

- PhasePacket builder
- Token budget policy
- Model registry
- Ollama provider
- OpenAI-compatible provider
- Hot/warm/cold policy stubs

### Exit criteria

- Planner receives only phase-local context.
- Coder receives allowed files and evidence only.
- Models can be swapped by config.

## Phase 4 — Patch Harness + Verifier

### Goal

Apply model patches safely and verify with commands.

### Deliverables

- Worktree manager
- Unified diff parser
- Patch apply/revert
- Command runner with timeouts
- Typecheck/lint/test hooks
- Attempt logging

### Exit criteria

- A patch can be generated, applied, tested, and accepted/reverted.
- Failed attempts are persisted.
- Confidence score is computed.

## Phase 5 — Docs Brain

### Goal

Add package/version-aware library guidance.

### Deliverables

- Package detector
- Local examples retriever
- Official docs ingestion interface
- Snippet reranking interface
- DocsPacket generation

### Exit criteria

- A library-sensitive task receives version-aware docs evidence.
- Coder can cite docs evidence IDs in patch plan.

## Phase 6 — Design Brain + frontend checks

### Goal

Support frontend design constraints and deterministic UI verification.

### Deliverables

- DESIGN.md parser
- Design token extraction
- Component inventory
- Playwright runner
- Screenshot artifact store
- Console/network error capture

### Exit criteria

- UI task receives DesignPacket.
- Playwright artifacts are stored.
- Frontend patch can be accepted/rejected from visual/test signals.

## Phase 7 — Bounded parallelism

### Goal

Execute non-overlapping task waves under hardware constraints.

### Deliverables

- Task DAG scheduler
- File lock manager
- Worktree-per-task support
- Merge verification
- Machine pressure monitor

### Exit criteria

- Independent tasks can run in parallel when hardware allows.
- Overlapping file edits are prevented.
- Repo Brain refreshes after merges.

## Phase 8 — Reviewer, bug analyst, escalation

### Goal

Add specialist models and sparse expert fallback.

### Deliverables

- Bug hypothesis phase
- Reviewer/veto phase
- Loop detection
- Escalation policy
- Optional remote model provider

### Exit criteria

- Repeated failure triggers strategy change or escalation.
- Reviewer can block risky/unscoped patches.

## Phase 9 — Evaluation and learning loop

### Goal

Turn traces into evaluation data and future fine-tuning material.

### Deliverables

- Private benchmark runner
- Baseline comparison framework
- Failure clustering
- Exportable training examples

### Exit criteria

- System can compare raw model vs full runtime on same tasks.
- Each failed mission produces diagnostic artifacts.
