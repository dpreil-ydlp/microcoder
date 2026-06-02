# Micro Mission Coder — Full Spec Pack v2 (Design Reintegration)

Generated with Open Design / shadcn/ui / chatcn design integration restored.


---

# FILE: 00_EXECUTIVE_BRIEF.md

# 00 — Executive Brief

## Product name

**Micro Mission Coder**

## One-line description

A hardware-aware local coding runtime that uses compact models, a durable mission ledger, semantic repo intelligence, and verifier-gated patch loops to complete software work in small, reliable steps.

## Primary problem

Small local coding models fail because they are asked to behave like large frontier models: read too much context, infer unclear requirements, explore codebases blindly, and self-judge correctness. Micro Mission Coder changes the shape of the problem. It gives the model only a small, fresh, evidence-backed task packet and makes deterministic tools responsible for repository knowledge, verification, rollback, scheduling, and confidence.

## Target user

A developer who wants a local/offline or privacy-preserving coding agent that can run on ordinary hardware, especially 24–32GB RAM machines, while scaling up to stronger local models on 64GB machines.

## Primary outcome

The system should outperform a raw local 3B–7B coding model on real repo tasks, especially multi-step tasks where spec discipline, file localization, verification, and persistent mission state matter.

## What this is not

- It is not a model swarm.
- It is not a frontier-model replacement.
- It is not an MCP-first architecture.
- It is not a chat memory wrapper.
- It is not a raw autocomplete assistant.

## Core thesis

A compact coder can perform useful long-horizon software work if the surrounding runtime handles the parts small models are bad at:

- remembering the mission
- clarifying specs
- locating relevant code
- retrieving version-aware docs
- enforcing tiny context windows
- applying patches safely
- running tests
- checking UI output
- deciding when to retry or escalate

## Minimum viable product

A CLI-based local system that can:

1. Create or ingest a spec.
2. Compile it into a task graph.
3. Build a Repo Brain index.
4. Select one task.
5. Generate a compact evidence packet.
6. Ask a local code model for a patch.
7. Apply the patch in a worktree.
8. Run typecheck/lint/tests.
9. Store the attempt in the Mission Ledger.
10. Continue or stop based on confidence.

## Initial stack recommendation

- Language: TypeScript/Node.js for orchestrator, CLI, schemas, and Playwright.
- Storage: SQLite + filesystem artifact store.
- Parsing: Tree-sitter.
- Language intelligence: LSP client adapters.
- Runtime model interface: OpenAI-compatible local HTTP, Ollama, llama.cpp router, or vLLM.
- Test/UI: native test commands + Playwright.
- Schemas: JSON Schema or Zod.

## Success criteria

The system is successful if, on a private repo-task benchmark, it beats raw Qwen2.5-Coder 3B/7B or Phi-mini-style local model prompting on:

- correct file localization
- patch apply rate
- test pass rate
- unrelated-edit reduction
- ability to resume long missions
- clarification quality
- lower context usage per task


---

# FILE: 01_PRODUCT_REQUIREMENTS.md

# 01 — Product Requirements

## Product goal

Build a local coding runtime that can take a rough software goal or detailed spec sheet, convert it into a durable mission, and execute implementation tasks through small evidence-backed model calls and verifier-gated patch loops.

## Primary personas

### Local developer

Wants a private coding helper that can work on a real repository without sending all code to cloud models.

### Agentic builder

Needs precise specs, schemas, tasks, and acceptance tests to implement the system incrementally.

### Power user

Wants to plug in stronger local models, optional cloud fallback, and frontend/vision verification.

## Product modes

### Constrained mode

Runs on 16GB RAM. Supports basic mission/spec/repo/patch/test loops. No vision. Minimal parallelism.

### Middle mode

Runs on 24–32GB RAM. This is the primary target. Supports full Mission Brain, Spec Brain, Repo Brain, Context Governor, Patch Harness, Docs Brain Lite, targeted Playwright, and a 3B–7B local coder.

### Strong local mode

Runs on 64GB+ RAM. Can use larger local coding models, more Playwright, optional VLM, richer docs/design indexing, and bounded parallel worktrees.

## Functional requirements

### FR-001 Mission creation

The system must create a `.mission/` directory containing durable mission state.

### FR-002 Spec ingestion

The system must ingest either a rough prompt, Markdown spec, or JSON spec.

### FR-003 Spec compilation

The system must compile the input into structured requirements, non-goals, acceptance criteria, risk flags, task graph, and verification plan.

### FR-004 Clarification gate

If the spec lacks measurable acceptance criteria or contains blocking ambiguity, implementation must stop and produce specific questions.

### FR-005 Repo Brain indexing

The system must index the repository using deterministic code-intelligence tools before code generation.

### FR-006 Freshness gate

If the Repo Brain index is stale, code generation must block until the index refreshes.

### FR-007 Context packet generation

Every model call must receive a compact PhasePacket with a strict token budget and phase-specific actions.

### FR-008 Patch-only editing

The code model must output patch artifacts, not mutate files directly.

### FR-009 Worktree isolation

Implementation tasks must run in a safe branch or git worktree.

### FR-010 Verification

The system must run configured typecheck, lint, tests, and optional Playwright checks before accepting a patch.

### FR-011 Confidence scoring

The system must calculate confidence from evidence and verifier signals.

### FR-012 Trace logging

Every model call, evidence packet, patch, command, result, and confidence decision must be logged.

### FR-013 Model orchestration

The runtime must support hot/warm/cold model states and load/offload behavior.

### FR-014 Hardware governor

The runtime must adjust context budgets, model loading, browser checks, and parallelism based on hardware profile.

### FR-015 Docs Brain

The runtime should detect package versions and retrieve compact official/local docs evidence for library-sensitive tasks.

### FR-016 Design Brain

The runtime should use `DESIGN.md`, design tokens, component inventory, and frontend rules for UI tasks.

### FR-017 Visual verification

The runtime should use Playwright first and optional VLM second for frontend verification.

### FR-018 Escalation

The runtime should support local or remote expert fallback when confidence is low or loop detection fires.

## Non-functional requirements

### NFR-001 Context efficiency

Default model packets should stay under 4K tokens in constrained/middle mode unless the Hardware Governor permits more.

### NFR-002 Determinism

All repository state, evidence, model outputs, patches, commands, and verification results must be reproducible from logs.

### NFR-003 Safety

Commands must run in a sandboxed workspace with explicit allowlists and timeouts.

### NFR-004 Hardware awareness

The system must never assume workstation-class resources.

### NFR-005 Extensibility

Models and runtimes must be pluggable through a small provider interface.

### NFR-006 No MCP hot path

The core runtime must use minimal internal contracts. MCP adapters may be added later, but not as the main in-process tool interface.

## Out of scope for initial build

- LoRA fine-tuning
- VLM-based design generation
- Fully autonomous multi-agent swarm
- Cloud-first operation
- Training-data generation at scale
- IDE extension
- Multi-user server mode


---

# FILE: 02_SYSTEM_ARCHITECTURE.md

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


---

# FILE: 03_BUILD_PHASES_AND_MILESTONES.md

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


---

# FILE: 04_HARDWARE_PROFILES.md

# 04 — Hardware Profiles

## Purpose

The system must scale behavior down or up depending on hardware. The architecture remains the same; activation changes.

## Profile A — Constrained mode

```yaml
name: constrained_16gb
ram_gb: 16
gpu: optional
ssd_gb: 512
primary_coder: qwen2.5-coder-3b-q4
controller: smollm2-360m-or-gemma-1b
vision: disabled
playwright: disabled_by_default
parallel_model_calls: 1
parallel_test_jobs: 0
context_budget_tokens: 2048-4096
```

### Enabled

- Mission Brain
- Spec Brain
- Repo Brain Lite
- Context Governor
- Patch Harness
- Typecheck/lint/targeted tests

### Disabled/limited

- VLM
- parallel worktrees
- heavy docs reranker
- full Playwright suite
- large local fallback

## Profile B — Middle mode

```yaml
name: middle_32gb
ram_gb: 24-32
gpu: optional_8gb_vram
ssd_gb: 1000
primary_coder: qwen2.5-coder-7b-q4-or-3b-q5
controller: gemma-1b-or-smollm2-1.7b-or-liquid-1.2b
vision: tiny_vlm_cold_optional
playwright: targeted
parallel_model_calls: 1
parallel_test_jobs: 1
context_budget_tokens: 4096-12000
```

### Enabled

- Full Mission Brain
- Spec Brain
- Repo Brain v1/v2
- Docs Brain Lite
- Design Brain text mode
- Patch Harness
- Targeted Playwright
- Model hot/warm/cold states
- Deterministic parallel tasks

## Profile C — Strong middle mode

```yaml
name: strong_middle_48gb
ram_gb: 48
gpu: optional_8_12gb_vram
ssd_gb: 1000-2000
primary_coder: qwen2.5-coder-7b-high-quality-or-larger-quant
controller: separate_tiny_model
vision: tiny_vlm_cold
playwright: enabled
parallel_model_calls: 1
parallel_test_jobs: 1-2
context_budget_tokens: 8000-24000
```

## Profile D — Strong local mode

```yaml
name: strong_local_64gb
ram_gb: 64+
gpu: optional_12_24gb_vram
ssd_gb: 2000+
primary_coder: qwen3-a3b-class-or-qwen3.6-35b-a3b-if-supported
controller: tiny_model_hot
vision: enabled_cold
playwright: enabled
parallel_model_calls: 1-heavy-plus-1-tiny
parallel_test_jobs: 2
context_budget_tokens: 8000-32000-default-longer-on-demand
```

## Hardware Governor behavior

### RAM pressure high

- unload cold models
- reduce context budget
- pause Playwright/VLM
- run only targeted tests

### CPU pressure high

- pause parallel test jobs
- reduce Repo Brain worker count
- disable speculative model warmup

### Battery mode

- single-track execution
- no VLM
- no full browser suite unless explicitly requested

### Thermal pressure high

- unload warm models after each step
- no heavy parallel commands
- prefer clarification/planning phases over codegen

## Main target

Build first for **Profile B: 24–32GB RAM**.

Do not optimize the first version for 64GB-only hardware. The project exists to make modest hardware useful.


---

# FILE: 05_AGENTIC_BUILDER_INSTRUCTIONS.md

# 05 — Agentic Builder Instructions

You are building Micro Mission Coder from this spec pack.

## Prime directive

Build the runtime, not a chat wrapper.

The product is a mission/spec/repo/verifier system with pluggable models. Do not collapse it into a single prompt around a coding model.

## Read order

1. `README.md`
2. `00_EXECUTIVE_BRIEF.md`
3. `01_PRODUCT_REQUIREMENTS.md`
4. `02_SYSTEM_ARCHITECTURE.md`
5. `03_BUILD_PHASES_AND_MILESTONES.md`
6. `07_SCHEMAS/`
7. `13_TASK_TICKETS.md`
8. `14_ACCEPTANCE_TESTS.md`

## Non-negotiable rules

- No MCP in the hot path.
- Do not expose a large tool catalog to models.
- Do not let the coder search the repo directly.
- Repo Brain must provide fresh evidence packets.
- If Repo Brain is stale, block until refresh completes.
- No patch without acceptance criteria.
- No direct file mutation by model output.
- All code changes go through the Patch Harness.
- Verification decides acceptance, not the model.
- Hardware profile controls activation.

## Implementation style

Use small, testable modules. Prefer boring interfaces. Every component should have deterministic unit tests before model behavior is wired in.

## Suggested stack

- TypeScript / Node.js 20+
- SQLite
- JSON Schema or Zod
- Playwright
- Tree-sitter bindings
- LSP JSON-RPC client
- OpenAI-compatible model provider interface
- Ollama and llama.cpp adapters first

## Build sequence

Do not skip phases.

1. CLI + config + storage
2. Mission Ledger
3. Spec Compiler
4. Repo Brain Lite
5. Context Governor
6. Model provider adapter
7. Patch Harness
8. Verifier
9. Confidence Engine
10. Docs/Design/Playwright later

## Definition of done for a phase

A phase is done only when:

- schemas validate
- unit tests pass
- CLI path works end to end for that phase
- trace logs are emitted
- hardware profile policy is respected
- acceptance tests for the phase pass

## Builder behavior

When implementing a ticket:

1. Restate the target ticket ID.
2. Inspect relevant spec files.
3. Produce a minimal implementation plan.
4. Write tests first when possible.
5. Implement only the ticket scope.
6. Run relevant tests.
7. Report changed files and verification results.

## Avoid

- giant framework choices before Phase 1 works
- premature cloud integration
- premature VLM integration
- multi-agent roleplay loops
- global prompt megafiles
- speculative abstractions not required by tickets

## First command to implement

```bash
mmc init
```

Expected behavior:

- creates `.mission/`
- creates config file if missing
- initializes SQLite DB
- writes empty mission state
- prints detected hardware profile


---

# FILE: 06_COMPONENT_SPECS/CONFIDENCE_ENGINE.md

# Confidence Engine Spec

## Responsibility

Compute accept/retry/escalate decisions from signals.

## Signals

Positive:

- patch applied cleanly
- targeted tests pass
- typecheck passes
- lint passes
- screenshot comparison passes
- touched expected files only
- official docs evidence used when needed

Negative:

- no reproduction
- same failure after retry
- stale evidence
- high-risk file touched
- security/payment/schema area touched
- reviewer disagreement
- visual failure

## Example scoring

```text
confidence =
  test_score
+ typecheck_score
+ lint_score
+ localization_score
+ docs_grounding_score
+ patch_scope_score
+ visual_score
- risk_score
- loop_score
- stale_context_score
```

## Decision bands

- 80–100: accept
- 60–79: accept with caveat or run broader tests
- 40–59: ask user, retrieve more evidence, or retry
- <40: escalate or block

## Rule

Do not ask the model if it is confident. The model may explain the score; it does not set it.


---

# FILE: 06_COMPONENT_SPECS/CONTEXT_GOVERNOR.md

# Context Governor Spec

## Responsibility

Build small, phase-specific model packets under hardware and task constraints.

## Inputs

- MissionSlice
- SpecSlice
- EvidencePacket
- DocsPacket
- DesignPacket
- HardwareProfile
- ModelProfile
- Phase

## Outputs

- PhasePacket

## Budget policy

Default middle-mode budgets:

| Phase | Target budget |
|---|---:|
| spec_critic | 800–1500 tokens |
| planner | 1000–2000 |
| code_patch | 2500–6000 |
| review | 1000–2500 |
| bug_analysis | 1500–3000 |
| docs_summary | 1000–2500 |

## Rules

- Include only phase-relevant actions.
- Include exact source snippets only when needed.
- Compress prior attempts aggressively.
- Exclude global tool catalogs.
- Exclude unrelated mission history.
- Include evidence IDs so outputs can cite them.

## Required functions

- `buildPhasePacket(phase, taskId)`
- `allocateBudget(packetInputs)`
- `compressEvidence(evidence, budget)`
- `validatePhasePacket(packet)`


---

# FILE: 06_COMPONENT_SPECS/DESIGN_BRAIN.md

# Design Brain Spec

## Responsibility

Provide frontend design constraints, component inventory, visual rules, and UI acceptance criteria.

## Inputs

- DESIGN.md
- existing components
- CSS/tailwind config
- design tokens
- screenshots/baselines
- accessibility rules

## Outputs

- DesignPacket

## Required functions

- `loadDesignSystem()`
- `extractTokens()`
- `inventoryComponents()`
- `detectFrontendTask(task)`
- `buildDesignPacket(task, budget)`
- `generateUiStateChecklist(task)`

## Required UI states for frontend tasks

- loading
- empty
- error
- success
- mobile
- desktop
- keyboard navigation when interactive

## Rules

- No random raw colors if tokens exist.
- No new component library unless explicitly allowed.
- Prefer existing component patterns.
- Require responsive checks for layout changes.

## Open Design / shadcn/ui / chatcn upgrade

Design Brain must support an optional Open Design integration. Open Design is a local-first design workflow and asset source; it is not the core coding harness.

Design Brain must also know when to use:

- existing repo components first;
- shadcn/ui as the default React/Tailwind component foundation when compatible;
- chatcn only for chat or agent-conversation surfaces;
- selected Open Design skills/systems/templates only when a design task benefits from them.

### New required functions

- `detectDesignSource(task, repo)`
- `selectComponentLibrary(task, repoDesign)`
- `buildDesignPacketV2(task, budget)`
- `selectOpenDesignAssets(task, budget)`
- `selectChatComponents(task)`
- `generateDesignVerificationQuestions(task, screenshots)`

### New rule

Never dump design catalogs into model context. Compile selected rules into `DesignPacketV2`.

See `21_OPEN_DESIGN_SHADCN_CHATCN_INTEGRATION.md` and `07_SCHEMAS/design_packet.v2.schema.json`.


---

# FILE: 06_COMPONENT_SPECS/DOCS_BRAIN.md

# Docs Brain Spec

## Responsibility

Provide version-aware library/framework guidance without relying on model memory.

## Inputs

- package files
- lockfiles
- imports
- task graph
- repo-local examples
- optional official docs cache

## Outputs

- DocsPacket

## Required functions

- `detectDependencies()`
- `detectRelevantLibraries(task)`
- `retrieveLocalExamples(library, version)`
- `retrieveOfficialDocs(library, version, query)`
- `rerankDocs(snippets, task)`
- `buildDocsPacket(task, budget)`

## Rules

- Prefer installed package version over latest public docs.
- Prefer official docs over blog posts.
- Prefer repo-local examples when matching existing patterns.
- Do not let docs evidence exceed the Context Governor budget.


---

# FILE: 06_COMPONENT_SPECS/ESCALATION_ENGINE.md

# Escalation Engine Spec

## Responsibility

Decide when to ask the user, call a larger local model, or call a remote expert.

## Escalation triggers

- repeated failure with unchanged error
- missing spec decision
- high-risk domain
- reviewer veto
- no relevant evidence found
- low confidence after repair loop
- task exceeds hardware profile

## Escalation types

1. Ask user a specific question.
2. Ask Repo Brain for more evidence.
3. Use larger local model if available.
4. Use remote expert if configured.
5. Stop and report blocker.

## Sparse expert rule

Expert fallback is advisory by default. The local harness still executes and verifies the patch.


---

# FILE: 06_COMPONENT_SPECS/MISSION_BRAIN.md

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


---

# FILE: 06_COMPONENT_SPECS/MODEL_ORCHESTRATOR.md

# Model Orchestrator Spec

## Responsibility

Manage model providers, routing, load/offload, context limits, and model role assignments.

## Model states

| State | Policy |
|---|---|
| hot | keep loaded if hardware permits |
| warm | keep during active mission or for TTL |
| cold | load on demand, unload after use |
| remote | use only under escalation policy |

## Required providers

- OpenAI-compatible HTTP
- Ollama
- llama.cpp server/router
- optional vLLM

## Required functions

- `listModels()`
- `loadModel(modelId)`
- `unloadModel(modelId)`
- `generate(request)`
- `routeByRole(role, hardwareProfile)`
- `enforceContextLimit(modelId, packet)`
- `recordLatencyAndMemory()`

## Rules

- Never load VLM speculatively in constrained or middle mode.
- Do not run two heavy code models at once in middle mode.
- Keep controller hot only if memory pressure is low.
- Unload cold models after phase completion.


---

# FILE: 06_COMPONENT_SPECS/OPEN_DESIGN_ADAPTER.md

# Open Design Adapter Spec

## Responsibility

Integrate selected Open Design assets into Micro Mission Coder's Design Brain while preserving small-context execution.

Open Design is not the execution harness. It is an optional design asset/workflow provider used for frontend and artifact-heavy tasks.

## Inputs

- frontend task packet
- compiled spec UI requirements
- existing repo design inventory
- optional Open Design installation path
- optional vendored Open Design skills/systems/templates
- hardware profile

## Outputs

- selected design system reference
- selected skill references
- selected template reference
- compact design-system excerpt
- prototype artifact metadata when generated
- DesignPacketV2 additions

## Required functions

- `detectOpenDesign()`
- `indexOpenDesignAssets()`
- `selectDesignSystem(task, repoDesign, budget)`
- `selectSkills(task, budget)`
- `extractDesignRules(selection, budget)`
- `generatePrototype(task, selection)` optional
- `summarizePrototypeForImplementation(artifact)`
- `buildOpenDesignSection(task, budget)`

## Context policy

Never include full Open Design catalogs in model context. Include only selected excerpts.

```ts
const LIMITS = {
  selectedSystems: 1,
  selectedSkills: 3,
  maxOpenDesignTokens: 1500
};
```

## Hardware policy

- 16GB: reference-only mode.
- 24–32GB: reference-only plus small prototype generation if scheduler approves.
- 48–64GB: prototype and critique modes allowed.

## Failure behavior

If Open Design is missing or incompatible, continue with local Design Brain, existing repo components, and shadcn/ui policy. Do not block non-design coding tasks.

## Security policy

Generated artifacts must be sandbox-previewed and stored under `.mission/artifacts/design/`. Do not execute arbitrary scripts from generated artifacts in the app workspace.


---

# FILE: 06_COMPONENT_SPECS/PATCH_HARNESS.md

# Patch Harness Spec

## Responsibility

Apply, test, accept, and revert model-generated patches safely.

## Required functions

- `createWorktree(taskId)`
- `parseUnifiedDiff(diff)`
- `validatePatchScope(patch, allowedFiles)`
- `applyPatch(patch)`
- `revertPatch(attemptId)`
- `formatChangedFiles()`
- `collectDiff()`
- `commitCheckpoint()`

## Patch rules

- Patches must be unified diffs or structured edit operations.
- Patches may touch only allowed files.
- New file creation must be explicitly allowed by task plan.
- Deletes require elevated risk flag.
- Large rewrites require reviewer phase.

## Rejection conditions

- patch does not apply
- touches forbidden files
- modifies unrelated files
- deletes code without task justification
- changes lockfile without dependency task
- verification fails and no repair loop remains


---

# FILE: 06_COMPONENT_SPECS/REPO_BRAIN.md

# Repo Brain Spec

## Responsibility

Maintain fresh, semantic repository intelligence and produce compact evidence packets for models.

## Index contents

- file tree
- language map
- symbols
- definitions
- references
- imports/exports
- routes
- API endpoints
- DB/schema files
- test map
- package versions
- diagnostics
- git SHA and dirty state
- component inventory for frontend repos

## Freshness rule

If Repo Brain status is not `fresh`, model code generation must block.

The coder must never bypass Repo Brain and search the repo directly. Raw grep is an internal Repo Brain capability only.

## Required adapters

- file scanner
- git status/SHA watcher
- Tree-sitter parser
- basic symbol extractor
- ripgrep internal search
- LSP adapter later
- test discovery

## Required functions

- `indexRepo()`
- `refreshDirtyFiles()`
- `getStatus()`
- `markStale(paths)`
- `waitUntilFresh()`
- `localizeTask(task)`
- `buildEvidencePacket(task, budget)`
- `findTestsForFiles(paths)`
- `findReferences(symbol)`
- `findDefinitions(symbol)`

## Evidence quality ranking

Prefer exact source snippets over summaries when patch generation depends on code syntax.

Ranking:

1. direct failing test / stack trace
2. exact target file snippet
3. direct caller/callee snippet
4. type/interface definition
5. repo-local pattern example
6. summarized architecture note
7. docs snippet

## Staleness triggers

- file changed
- patch applied
- branch/worktree changed
- package lock changed
- test file changed
- LSP diagnostic change
- merge completed


---

# FILE: 06_COMPONENT_SPECS/SPEC_BRAIN.md

# Spec Brain Spec

## Responsibility

Turn a rough goal or spec sheet into an executable, verifiable task graph.

## Inputs

- natural language prompt
- Markdown spec
- JSON spec
- existing `.mission/spec.json`

## Outputs

- compiled spec
- clarification questions
- task graph
- verification plan
- risk flags

## Hard gates

Implementation must block if:

- no measurable acceptance criteria exist
- security/payment/PII behavior is ambiguous
- schema migration lacks rollback plan
- UI task lacks expected states
- target repo area cannot be localized

## Clarification question rules

Ask precise questions. Do not ask generic “provide more details” questions.

Good:

> Should invoices be loaded from Stripe directly or from the local database cache?

Bad:

> Can you clarify the billing dashboard?

## Required functions

- `compileSpec(input)`
- `detectAmbiguity(spec)`
- `generateClarifyingQuestions(spec)`
- `generateTaskGraph(spec, repoHints)`
- `generateVerificationPlan(spec)`

## Task graph output

Each task must include:

- ID
- title
- requirement IDs
- acceptance criteria IDs
- dependencies
- allowed file hints if known
- verification commands if known
- risk flags


---

# FILE: 06_COMPONENT_SPECS/TASK_SCHEDULER.md

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


---

# FILE: 06_COMPONENT_SPECS/TRACE_STORE.md

# Trace Store Spec

## Responsibility

Persist all runtime events for debugging, evaluation, and future training.

## Required logs

- mission state changes
- spec compiler output
- task graph changes
- evidence packets
- phase packets
- model requests/responses
- patches
- command outputs
- artifacts
- confidence scores
- escalation decisions

## Storage recommendation

- SQLite for indexed metadata
- filesystem for large artifacts
- JSONL for attempts/events

## Export formats

- benchmark replay bundle
- training examples
- failure report
- task summary


---

# FILE: 06_COMPONENT_SPECS/VERIFIER.md

# Verifier Spec

## Responsibility

Run deterministic checks and collect artifacts.

## Check types

- formatter
- typecheck
- lint
- unit tests
- integration tests
- targeted tests
- full test suite when allowed
- Playwright checks
- screenshot comparison
- console/network error capture

## Required functions

- `runCommand(command, timeout)`
- `runVerificationPlan(task)`
- `selectTargetedTests(files)`
- `collectArtifacts()`
- `summarizeFailures()`

## Rules

- Targeted checks first, broader checks later.
- Commands must have timeouts.
- Dangerous commands require allowlist approval.
- Artifacts must be attached to attempt logs.


---

# FILE: 07_SCHEMAS/attempt.schema.json

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Attempt",
  "type": "object",
  "required": [
    "attempt_id",
    "task_id",
    "started_at",
    "status"
  ],
  "properties": {
    "attempt_id": {
      "type": "string"
    },
    "task_id": {
      "type": "string"
    },
    "phase": {
      "type": "string"
    },
    "model_id": {
      "type": "string"
    },
    "started_at": {
      "type": "string"
    },
    "ended_at": {
      "type": "string"
    },
    "status": {
      "enum": [
        "started",
        "patch_generated",
        "applied",
        "verified",
        "failed",
        "reverted",
        "accepted"
      ]
    },
    "patch_path": {
      "type": "string"
    },
    "verification_results": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "confidence_score": {
      "type": "number"
    }
  }
}

```


---

# FILE: 07_SCHEMAS/confidence.schema.json

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ConfidenceReport",
  "type": "object",
  "required": [
    "score",
    "decision",
    "signals"
  ],
  "properties": {
    "score": {
      "type": "number",
      "minimum": 0,
      "maximum": 100
    },
    "decision": {
      "enum": [
        "accept",
        "accept_with_caveat",
        "retry",
        "ask_user",
        "escalate",
        "block"
      ]
    },
    "signals": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "name",
          "value",
          "weight"
        ],
        "properties": {
          "name": {
            "type": "string"
          },
          "value": {
            "type": "number"
          },
          "weight": {
            "type": "number"
          }
        }
      }
    },
    "summary": {
      "type": "string"
    }
  }
}

```


---

# FILE: 07_SCHEMAS/design_packet.v2.schema.json

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://micro-mission-coder.local/schemas/design_packet.v2.schema.json",
  "title": "DesignPacketV2",
  "type": "object",
  "required": [
    "packet_version",
    "task_id",
    "ui_surface",
    "primary_design_source",
    "component_library",
    "tokens",
    "allowed_components",
    "required_states",
    "viewports",
    "accessibility_rules",
    "verification_questions"
  ],
  "properties": {
    "packet_version": {
      "const": "design-packet-v2"
    },
    "task_id": {
      "type": "string"
    },
    "ui_surface": {
      "type": "string"
    },
    "primary_design_source": {
      "enum": [
        "existing_repo",
        "shadcn_ui",
        "chatcn",
        "open_design",
        "user_reference"
      ]
    },
    "component_library": {
      "type": "string"
    },
    "open_design": {
      "type": "object",
      "properties": {
        "enabled": {
          "type": "boolean"
        },
        "selected_system": {
          "type": [
            "string",
            "null"
          ]
        },
        "selected_skills": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 3
        },
        "selected_template": {
          "type": [
            "string",
            "null"
          ]
        },
        "brief_id": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "additionalProperties": false
    },
    "tokens": {
      "type": "object"
    },
    "allowed_components": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "forbidden_components": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "required_states": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "viewports": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "accessibility_rules": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "interaction_rules": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "visual_references": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "anti_patterns": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "verification_questions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "additionalProperties": true
}
```


---

# FILE: 07_SCHEMAS/evidence_packet.schema.json

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "EvidencePacket",
  "type": "object",
  "required": [
    "packet_id",
    "task_id",
    "repo_sha",
    "index_sha",
    "freshness",
    "items"
  ],
  "properties": {
    "packet_id": {
      "type": "string"
    },
    "task_id": {
      "type": "string"
    },
    "repo_sha": {
      "type": "string"
    },
    "index_sha": {
      "type": "string"
    },
    "generated_at": {
      "type": "string"
    },
    "freshness": {
      "const": "fresh"
    },
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/evidenceItem"
      }
    }
  },
  "$defs": {
    "evidenceItem": {
      "type": "object",
      "required": [
        "id",
        "type",
        "summary",
        "source"
      ],
      "properties": {
        "id": {
          "type": "string"
        },
        "type": {
          "enum": [
            "source_snippet",
            "symbol",
            "test",
            "diagnostic",
            "doc",
            "design",
            "attempt",
            "git"
          ]
        },
        "path": {
          "type": "string"
        },
        "source": {
          "type": "string"
        },
        "summary": {
          "type": "string"
        },
        "content": {
          "type": "string"
        },
        "rank": {
          "type": "number"
        }
      }
    }
  }
}

```


---

# FILE: 07_SCHEMAS/hardware_profile.schema.json

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "HardwareProfile",
  "type": "object",
  "required": [
    "name",
    "ram_gb",
    "parallel_model_calls",
    "context_budget_tokens"
  ],
  "properties": {
    "name": {
      "type": "string"
    },
    "ram_gb": {
      "type": "number"
    },
    "vram_gb": {
      "type": [
        "number",
        "null"
      ]
    },
    "ssd_gb": {
      "type": "number"
    },
    "parallel_model_calls": {
      "type": "integer"
    },
    "parallel_test_jobs": {
      "type": "integer"
    },
    "context_budget_tokens": {
      "type": "integer"
    },
    "vision_enabled": {
      "type": "boolean"
    },
    "playwright_enabled": {
      "type": "boolean"
    }
  }
}

```


---

# FILE: 07_SCHEMAS/mission.schema.json

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Mission",
  "type": "object",
  "required": [
    "mission_id",
    "goal",
    "status",
    "created_at",
    "current_task_id"
  ],
  "properties": {
    "mission_id": {
      "type": "string"
    },
    "goal": {
      "type": "string"
    },
    "status": {
      "enum": [
        "draft",
        "active",
        "blocked",
        "complete",
        "failed"
      ]
    },
    "created_at": {
      "type": "string"
    },
    "updated_at": {
      "type": "string"
    },
    "current_task_id": {
      "type": [
        "string",
        "null"
      ]
    },
    "decision_ids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "risk_flags": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}

```


---

# FILE: 07_SCHEMAS/model_registry.schema.json

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ModelRegistry",
  "type": "object",
  "required": [
    "models"
  ],
  "properties": {
    "models": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "role",
          "provider",
          "state_policy"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "role": {
            "type": "string"
          },
          "provider": {
            "type": "string"
          },
          "context_limit": {
            "type": "integer"
          },
          "state_policy": {
            "enum": [
              "hot",
              "warm",
              "cold",
              "remote"
            ]
          },
          "hardware_min_ram_gb": {
            "type": "number"
          }
        }
      }
    }
  }
}

```


---

# FILE: 07_SCHEMAS/phase_packet.schema.json

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "PhasePacket",
  "type": "object",
  "required": [
    "phase",
    "task_id",
    "budget_tokens",
    "allowed_actions",
    "evidence_ids",
    "required_output"
  ],
  "properties": {
    "phase": {
      "enum": [
        "spec_critic",
        "planner",
        "code_patch",
        "test_writer",
        "bug_analysis",
        "review",
        "docs_summary",
        "design_critic"
      ]
    },
    "task_id": {
      "type": "string"
    },
    "budget_tokens": {
      "type": "integer"
    },
    "allowed_actions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "allowed_files": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "forbidden_files": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "mission_slice": {
      "type": "object"
    },
    "spec_slice": {
      "type": "object"
    },
    "evidence_ids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "evidence": {
      "type": "array",
      "items": {
        "type": "object"
      }
    },
    "required_output": {
      "type": "string"
    }
  }
}

```


---

# FILE: 07_SCHEMAS/spec.schema.json

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CompiledSpec",
  "type": "object",
  "required": [
    "spec_id",
    "goal",
    "requirements",
    "acceptance_criteria",
    "non_goals",
    "risk_flags"
  ],
  "properties": {
    "spec_id": {
      "type": "string"
    },
    "goal": {
      "type": "string"
    },
    "non_goals": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "requirements": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/requirement"
      }
    },
    "acceptance_criteria": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/acceptance"
      }
    },
    "ui_states": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "security_constraints": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "data_model_changes": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "risk_flags": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "$defs": {
    "requirement": {
      "type": "object",
      "required": [
        "id",
        "text"
      ],
      "properties": {
        "id": {
          "type": "string"
        },
        "text": {
          "type": "string"
        }
      }
    },
    "acceptance": {
      "type": "object",
      "required": [
        "id",
        "text",
        "verification"
      ],
      "properties": {
        "id": {
          "type": "string"
        },
        "text": {
          "type": "string"
        },
        "verification": {
          "type": "string"
        }
      }
    }
  }
}

```


---

# FILE: 07_SCHEMAS/task_graph.schema.json

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "TaskGraph",
  "type": "object",
  "required": [
    "tasks"
  ],
  "properties": {
    "tasks": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/task"
      }
    }
  },
  "$defs": {
    "task": {
      "type": "object",
      "required": [
        "id",
        "title",
        "status",
        "depends_on",
        "acceptance_ids"
      ],
      "properties": {
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "status": {
          "enum": [
            "todo",
            "ready",
            "running",
            "blocked",
            "complete",
            "failed"
          ]
        },
        "depends_on": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requirement_ids": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "acceptance_ids": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "allowed_files": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "forbidden_files": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "verification_commands": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "risk_flags": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    }
  }
}

```


---

# FILE: 08_API_CONTRACTS.md

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


---

# FILE: 09_DATABASE_SCHEMA.md

# 09 — Database Schema

Recommended storage: SQLite for metadata plus filesystem for large artifacts.

## Tables

### missions

```sql
CREATE TABLE missions (
  mission_id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  current_task_id TEXT
);
```

### specs

```sql
CREATE TABLE specs (
  spec_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### tasks

```sql
CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  depends_on_json TEXT NOT NULL,
  acceptance_ids_json TEXT NOT NULL,
  allowed_files_json TEXT,
  risk_flags_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### repo_index

```sql
CREATE TABLE repo_index (
  index_sha TEXT PRIMARY KEY,
  repo_sha TEXT NOT NULL,
  status TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  dirty_files_json TEXT NOT NULL
);
```

### evidence_packets

```sql
CREATE TABLE evidence_packets (
  packet_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  repo_sha TEXT NOT NULL,
  index_sha TEXT NOT NULL,
  packet_json TEXT NOT NULL,
  generated_at TEXT NOT NULL
);
```

### attempts

```sql
CREATE TABLE attempts (
  attempt_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  model_id TEXT,
  status TEXT NOT NULL,
  patch_path TEXT,
  confidence_score REAL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
```

### events

```sql
CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  mission_id TEXT,
  task_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### artifacts

```sql
CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  attempt_id TEXT,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL
);
```


---

# FILE: 10_CLI_SPEC.md

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


---

# FILE: 11_RUNTIME_CONFIG_EXAMPLE.yaml

```yaml
project:
  name: micro-mission-coder
  mission_dir: .mission
  database_path: .mission/mmc.sqlite

hardware:
  profile: middle_32gb
  max_ram_gb: 32
  max_vram_gb: 8
  max_parallel_model_calls: 1
  max_parallel_test_jobs: 1
  context_budget_tokens: 8192
  battery_saver: false

repo_brain:
  enabled: true
  require_fresh_index: true
  tree_sitter: true
  lsp: false
  ripgrep_internal: true
  refresh_on_patch: true

context:
  no_global_tool_catalog: true
  default_code_patch_budget_tokens: 4096
  default_planner_budget_tokens: 1800
  include_evidence_ids: true

models:
  provider_default: ollama
  registry_path: ./12_MODEL_PROFILES.yaml
  unload_cold_after_seconds: 30
  keep_warm_for_seconds: 300

harness:
  use_worktrees: true
  patch_only: true
  command_timeout_seconds: 120
  allow_dependency_install: false
  allowed_commands:
    - pnpm typecheck
    - pnpm lint
    - pnpm test
    - npm test
    - pytest

verification:
  targeted_tests_first: true
  full_tests_on_high_confidence_only: false
  playwright_enabled: true
  playwright_targeted_only: true

vision:
  enabled: false
  cold_load_only: true

evaluation:
  trace_all_model_calls: true
  store_artifacts: true
  baseline_raw_model: qwen2.5-coder-7b-q4

design:
  open_design:
    enabled: optional
    mode_by_hardware:
      "16gb": reference_only
      "24_32gb": reference_or_small_prototype
      "48_64gb": prototype_and_critique
    max_selected_skills: 3
    max_design_tokens: 1500
    use_mcp_hot_path: false
  shadcn_ui:
    enabled: true
    policy: prefer_existing_repo_components_first
  chatcn:
    enabled: optional
    use_only_for_surfaces:
      - chat
      - agent_conversation
      - messaging

```


---

# FILE: 12_MODEL_PROFILES.yaml

```yaml
models:
  - id: smollm2-360m
    role: spec_critic
    provider: ollama
    state_policy: hot
    hardware_min_ram_gb: 8
    context_limit: 8192

  - id: gemma-3-1b
    role: planner
    provider: ollama
    state_policy: hot
    hardware_min_ram_gb: 8
    context_limit: 32768

  - id: liquid-lfm2-1.2b
    role: planner
    provider: llamacpp
    state_policy: warm
    hardware_min_ram_gb: 16
    context_limit: 32768

  - id: qwen2.5-coder-3b-q5
    role: code_writer
    provider: ollama
    state_policy: warm
    hardware_min_ram_gb: 16
    context_limit: 32768

  - id: qwen2.5-coder-7b-q4
    role: code_writer
    provider: ollama
    state_policy: warm
    hardware_min_ram_gb: 24
    context_limit: 32768

  - id: phi-4-mini
    role: test_writer
    provider: ollama
    state_policy: cold
    hardware_min_ram_gb: 24
    context_limit: 32768

  - id: moondream-small
    role: visual_inspector
    provider: llamacpp
    state_policy: cold
    hardware_min_ram_gb: 32
    context_limit: 8192

role_policy:
  constrained_16gb:
    spec_critic: smollm2-360m
    planner: gemma-3-1b
    code_writer: qwen2.5-coder-3b-q5
    test_writer: code_writer
    reviewer: planner
    visual_inspector: disabled

  middle_32gb:
    spec_critic: gemma-3-1b
    planner: liquid-lfm2-1.2b
    code_writer: qwen2.5-coder-7b-q4
    test_writer: phi-4-mini
    reviewer: gemma-3-1b
    visual_inspector: disabled_by_default

  strong_local_64gb:
    spec_critic: gemma-3-1b
    planner: liquid-lfm2-1.2b
    code_writer: qwen3-a3b-class-local
    test_writer: qwen2.5-coder-7b-q4
    reviewer: phi-4-mini
    visual_inspector: moondream-small

```


---

# FILE: 13_TASK_TICKETS.md

# 13 — Task Tickets

## EPIC A — Project foundation

### A1 — Create CLI skeleton

Implement `mmc` CLI with `init`, `doctor`, and help output.

Acceptance:

- `mmc --help` works.
- `mmc init` creates project config and `.mission/`.
- Unit tests cover command parsing.

### A2 — Config loader

Implement YAML config loader with defaults and validation.

Acceptance:

- Missing config uses defaults.
- Invalid config reports schema errors.

### A3 — SQLite storage

Implement DB migrations for required tables.

Acceptance:

- DB initializes on `mmc init`.
- Migrations are idempotent.

## EPIC B — Mission and Spec Brain

### B1 — Mission Ledger

Implement mission creation/read/update.

Acceptance:

- Mission JSON validates schema.
- Attempts append to JSONL.

### B2 — Spec ingestion

Support prompt/Markdown/JSON spec input.

Acceptance:

- JSON spec validates.
- Markdown spec is converted into draft structured spec.

### B3 — Spec compiler

Compile requirements, non-goals, acceptance criteria, risk flags.

Acceptance:

- Missing acceptance criteria blocks implementation.
- Blocking questions are specific.

### B4 — Task graph generator

Generate task DAG from compiled spec.

Acceptance:

- Dependencies are acyclic.
- Each task links to acceptance criteria.

## EPIC C — Repo Brain

### C1 — File scanner and git state

Index file tree and git SHA.

Acceptance:

- Repo status reports fresh/stale.
- Dirty files are detected.

### C2 — Tree-sitter indexing

Extract symbols from TypeScript/JavaScript files.

Acceptance:

- Functions/classes/components are indexed.
- Syntax errors are reported without crashing.

### C3 — Test discovery

Map tests to files using patterns and imports.

Acceptance:

- Finds test files for changed modules.

### C4 — Evidence packet builder

Generate budgeted evidence for a task.

Acceptance:

- Packet validates schema.
- Packet freshness must be fresh.

## EPIC D — Context and models

### D1 — Context Governor

Generate PhasePackets.

Acceptance:

- Packet contains only allowed actions.
- Budget policy is enforced.

### D2 — Model provider abstraction

Implement provider interface.

Acceptance:

- Mock provider passes tests.
- Ollama provider can generate text if available.

### D3 — Model Orchestrator

Implement role routing and hot/warm/cold policy.

Acceptance:

- Config maps roles to model IDs.
- Cold models unload after phase.

## EPIC E — Patch Harness and Verifier

### E1 — Worktree manager

Create and cleanup task worktrees.

Acceptance:

- Worktree created for task.
- Cleanup preserves artifacts.

### E2 — Patch parser/apply

Apply unified diff safely.

Acceptance:

- Rejects patches outside allowed files.
- Reverts failed patch.

### E3 — Command runner

Run verifier commands with timeouts.

Acceptance:

- Captures stdout/stderr/exit code.
- Timeout kills command.

### E4 — Confidence Engine

Compute confidence and decision.

Acceptance:

- Scores pass/fail fixtures correctly.

## EPIC F — Docs and Design

### F1 — Dependency detector

Parse package files and lockfiles.

### F2 — Local examples retriever

Find repo examples using imports/symbols.

### F3 — DESIGN.md parser

Extract design rules and tokens.

### F4 — Component inventory

Index frontend components.

## EPIC G — Frontend verification

### G1 — Playwright runner

Run targeted browser checks.

### G2 — Screenshot artifacts

Store screenshots and diff summaries.

### G3 — Accessibility checklist

Add basic a11y checks or hooks.

## EPIC H — Parallelism and escalation

### H1 — Task scheduler

Implement dependency wave scheduling.

### H2 — File locks

Prevent overlapping edits.

### H3 — Loop detection

Detect repeated failure.

### H4 — Escalation policy

Ask user / local stronger model / remote expert.

## EPIC I — Evaluation

### I1 — Raw model baseline runner

Run same tasks with raw coder prompt.

### I2 — Full runtime benchmark runner

Run same tasks through MMC.

### I3 — Metrics report

Compare localization, patch, verification, and success rates.

## Open Design / Design Brain integration tickets

### OD-1 — Add OpenDesignAdapter

Implement optional Open Design asset detection/indexing and selection. Do not expose Open Design catalogs to model context.

### OD-2 — Add DesignPacketV2

Add schema, generator, and frontend task integration.

### OD-3 — Add shadcn/ui component inventory policy

Prefer existing repo components first. Use shadcn/ui when compatible and no existing pattern exists.

### OD-4 — Add chatcn policy

Use chatcn only for chat surfaces. Add verification for streaming, long messages, file attachments, code blocks, and mobile scrolling.

### OD-5 — Add Open Design artifact storage

Store generated design artifacts under `.mission/artifacts/design/` and mark them as drafts until verified.

### OD-6 — Add Design Confidence subscore

Confidence Engine must score design compliance, visual verifier results, accessibility, and consistency with DesignPacketV2.


---

# FILE: 14_ACCEPTANCE_TESTS.md

# 14 — Acceptance Tests

## System acceptance test A — init and mission creation

Input:

```bash
mmc init
mmc spec create "Add a billing dashboard that shows recent invoices"
```

Expected:

- `.mission/` exists.
- DB exists.
- draft spec exists.
- missing details produce clarification questions.

## System acceptance test B — spec gate blocks vague request

Input:

```bash
mmc spec create "make the dashboard better"
mmc mission start
```

Expected:

- implementation does not begin.
- output asks specific questions about desired improvements and acceptance criteria.

## System acceptance test C — Repo Brain freshness gate

Setup:

1. Index repo.
2. Modify target file.
3. Attempt code patch.

Expected:

- system detects stale index.
- code generation blocks.
- Repo Brain refreshes.
- evidence packet is regenerated.

## System acceptance test D — patch scope enforcement

Setup:

Task allows only `src/components/InvoiceTable.tsx`.

Model emits patch touching `src/lib/auth.ts`.

Expected:

- Patch Harness rejects patch.
- attempt logged as failed_scope.
- no file is modified.

## System acceptance test E — verification-gated acceptance

Setup:

Model emits valid patch that fails typecheck.

Expected:

- patch is not accepted.
- failure summary is logged.
- repair loop or escalation decision is created.

## System acceptance test F — mission resume

Setup:

Start mission, complete task T1, stop process, restart.

Expected:

- mission resumes at next unblocked task.
- prior attempt summary is available.
- model does not need chat history.

## System acceptance test G — hardware profile downgrade

Setup:

Set profile to `constrained_16gb`.

Expected:

- VLM disabled.
- parallel worktrees disabled.
- context budget reduced.
- one model call at a time.

## System acceptance test H — frontend targeted verification

Setup:

Frontend task modifies a page component.

Expected:

- DesignPacket generated if DESIGN.md exists.
- Playwright targeted check runs if enabled.
- console errors are captured.
- screenshots stored as artifacts.

## Benchmark acceptance criterion

On a 20-task internal benchmark, the full runtime must beat raw local coder prompting on at least three of these five metrics:

- correct file localization
- patch apply rate
- typecheck/test pass rate
- unrelated edits avoided
- multi-step mission completion rate

## Design integration acceptance tests

- Given a frontend task, the system emits `DesignPacketV2` before code generation.
- Given an existing component pattern, the coder uses the existing component instead of importing a new design system.
- Given a compatible React/Tailwind project with no component pattern, shadcn/ui may be selected.
- Given a chat UI task, chatcn may be selected and chat-specific visual checks are generated.
- Given Open Design installed, the adapter indexes skills/systems/templates but includes only selected excerpts in model context.
- Given 16GB hardware profile, Open Design runs in reference-only mode and VLM is disabled by default.
- Given a generated Open Design prototype, the implementation step summarizes/translates it rather than blindly pasting it into app code.


---

# FILE: 15_SECURITY_AND_SANDBOXING.md

# 15 — Security and Sandboxing

## Security posture

The system runs local commands and edits code. Treat model output as untrusted.

## Command policy

Default allowed commands:

- typecheck
- lint
- test
- format
- Playwright test if configured

Default blocked commands:

- network install commands unless approved
- destructive filesystem commands
- credential access
- deployment commands
- database migration against non-local DB
- git push
- secret scanning bypasses

## Secrets

- Never include `.env` values in model context.
- Redact secrets from command output.
- Detect common secret patterns in patches.

## Patch safety

- Reject patches touching secrets/config unless task explicitly allows it.
- Reject patches that disable tests without explicit approval.
- Require elevated risk for auth/payment/schema changes.

## Worktree safety

- Use isolated git worktrees for implementation tasks.
- Never modify user branch directly unless configured.
- Always create checkpoint before patch application.

## Remote escalation

If remote model fallback is enabled:

- redact secrets
- send only the PhasePacket, not full repo
- require user opt-in for sensitive files
- log every remote call


---

# FILE: 16_FRONTEND_DESIGN_VERIFICATION.md

# 16 — Frontend Design Verification

## Goal

Make frontend changes testable and less ugly without relying on vague model taste.

## Design Brain inputs

- `DESIGN.md`
- Tailwind config
- CSS variables
- existing components
- screenshots/baselines
- accessibility rules
- target viewport list

## Required DesignPacket fields

```json
{
  "component_library": "shadcn/ui",
  "tokens": {},
  "component_patterns": [],
  "forbidden_patterns": [],
  "required_states": ["loading", "empty", "error", "success"],
  "viewports": ["390x844", "1440x900"],
  "accessibility_rules": []
}
```

## Verification order

1. Typecheck.
2. Lint.
3. Unit/component tests.
4. Start app.
5. Playwright route load.
6. Console/network error capture.
7. DOM assertions.
8. Screenshot comparison.
9. Optional VLM semantic inspection.

## VLM policy

Only call VLM after screenshots exist.

Good VLM question:

> At 390px width, is the primary CTA visible, readable, and not overlapping the invoice table?

Bad VLM question:

> Does this look good?

## Frontend rejection conditions

- console error
- network error on expected local route
- visible overflow on required viewport
- missing loading/error/empty state
- inaccessible interactive element
- raw colors when tokens exist
- component pattern inconsistent with DesignPacket

## Open Design and chat UI verification additions

Frontend tasks must now classify their surface type before patch generation:

- dashboard
- landing
- form
- chat
- settings
- report
- auth
- other

For `chat` surfaces, include chat-specific checks:

- long message wrapping
- code block rendering
- attachment preview/error state
- streaming/loading state
- retry failed message state
- thread/reaction UI if present
- mobile scroll behavior

For Open Design-assisted tasks, verify that the implemented patch preserves the selected design-system rules and does not blindly paste a prototype into production code.

The verifier must save:

- Playwright screenshots
- DOM assertion logs
- console/network logs
- optional VLM/design-critic result
- selected DesignPacketV2

All artifacts go under `.mission/artifacts/visual/` or `.mission/artifacts/design/`.


---

# FILE: 17_EVALUATION_PLAN.md

# 17 — Evaluation Plan

## Main question

Does Micro Mission Coder outperform raw local model prompting on real repo tasks under the same hardware constraints?

## Baselines

A. Raw local coder prompt.
B. Local coder + hand-fed files.
C. Local coder + Repo Brain only.
D. Full Micro Mission Coder.
E. Optional strong local model inside Micro Mission Coder.

## Benchmark set

Create 20–50 tasks:

- small bugfix
- add test
- TypeScript error fix
- API route change
- form field addition
- frontend responsive fix
- component extraction
- library usage fix
- simple refactor
- spec-to-implementation mission

## Metrics

| Metric | Definition |
|---|---|
| correct localization | selected files include needed edit location |
| patch apply rate | generated patch applies cleanly |
| verification pass rate | configured checks pass |
| unrelated edits | patch touches files outside task scope |
| clarification quality | vague task yields useful question |
| context tokens used | total prompt tokens per successful task |
| mission completion | multi-task spec completed correctly |
| human intervention count | number of user clarifications/escalations |
| latency | wall-clock time per task |
| machine pressure | RAM/CPU/GPU peak |

## Required comparison

The system should be killed or simplified if full runtime does not beat raw local model on repo tasks.

## Trace exports

Each benchmark run must export:

- task spec
- evidence packets
- prompts
- model outputs
- patches
- verification results
- confidence report
- final decision


---

# FILE: 18_RISKS_AND_DECISIONS.md

# 18 — Risks and Decisions

## Architectural decisions

### ADR-001 No MCP hot path

Decision: Do not use MCP as the core model-tool interface.

Reason: Context is precious. The system uses narrow PhasePackets instead of broad tool catalogs.

### ADR-002 Repo Brain freshness blocks codegen

Decision: If Repo Brain is stale, execution blocks until refresh completes.

Reason: Allowing the model to bypass stale indexing with direct search undermines the whole small-context architecture.

### ADR-003 Patch-only editing

Decision: Model output must be patch-only.

Reason: Enables scope enforcement, rollback, and verification.

### ADR-004 Mission Ledger over chat history

Decision: Long-horizon state lives in files/DB, not conversation context.

Reason: Makes small context windows viable.

### ADR-005 Hardware profiles control activation

Decision: Same architecture across tiers, different activation.

Reason: Preserves product vision while running on modest machines.

## Major risks

### Risk 1 — Too much orchestration overhead

Mitigation: Benchmark against raw local model after each phase.

### Risk 2 — Repo Brain inaccurate or stale

Mitigation: freshness gates, source-exact evidence, index SHA tracking, fallback to direct source read inside Repo Brain only.

### Risk 3 — Small coder underperforms

Mitigation: use stronger coder when hardware allows; keep runtime model-pluggable.

### Risk 4 — Visual checks are flaky

Mitigation: deterministic Playwright environment, targeted screenshots, VLM optional only.

### Risk 5 — Model outputs unsafe commands/patches

Mitigation: command allowlists, patch scope validation, worktrees, secrets redaction.

### Risk 6 — Agentic builder overbuilds swarm logic

Mitigation: strict tickets and non-negotiable rule: deterministic pipeline first, specialists later.


---

# FILE: 19_PROMPTS/bug_analyst.md

# Prompt — Bug Analyst

You analyze failing verification output.

Rules:

- Do not guess without evidence.
- Generate 2–5 hypotheses.
- For each hypothesis, list evidence needed and likely files.
- Prefer reproducible failure signals.

Return JSON only.

```json
{
  "failure_summary": "",
  "hypotheses": [
    {
      "id": "H1",
      "cause": "",
      "evidence": [],
      "files_to_inspect": [],
      "confidence": 0.0
    }
  ],
  "next_action": "inspect" | "patch" | "revert" | "escalate"
}
```


---

# FILE: 19_PROMPTS/design_critic.md

# Prompt — Design Critic

You review frontend output against DesignPacket and visual artifacts.

Rules:

- Do not judge vague beauty.
- Check concrete layout, states, accessibility, consistency, and responsiveness.
- Use screenshot/DOM evidence only.

Return JSON only.

```json
{
  "decision": "pass" | "fail" | "needs_human_review",
  "issues": [],
  "required_fixes": [],
  "evidence_ids": []
}
```


---

# FILE: 19_PROMPTS/docs_summarizer.md

# Prompt — Docs Summarizer

You summarize retrieved docs for a coding task.

Rules:

- Use only provided docs snippets.
- Preserve library version if provided.
- Include common pitfalls.
- Do not invent APIs.

Return JSON only.

```json
{
  "library": "",
  "version": "",
  "correct_usage": "",
  "pitfalls": [],
  "relevant_snippet_ids": []
}
```


---

# FILE: 19_PROMPTS/patch_writer.md

# Prompt — Patch Writer

You are the Code Patch Writer for Micro Mission Coder.

You receive a PhasePacket with allowed files and evidence.

Rules:

- Emit only a unified diff.
- Touch only allowed files.
- Make the smallest change that satisfies acceptance criteria.
- Do not refactor unrelated code.
- Do not modify tests unless task allows test changes.
- If evidence is insufficient, output REQUEST_MORE_EVIDENCE with exact file/symbol need.

Output one of:

1. Unified diff.
2. `REQUEST_MORE_EVIDENCE: <specific need>`
3. `DECLINE: <reason>`


---

# FILE: 19_PROMPTS/planner.md

# Prompt — Planner

You are the Planner for Micro Mission Coder.

You receive a PhasePacket. Choose the next safe action.

Rules:

- Do not invent repo context.
- Do not request broad repo search.
- Use only provided evidence IDs.
- If evidence is insufficient, request specific additional evidence.
- If Repo Brain freshness is not fresh, return block.

Return JSON only.

```json
{
  "action": "request_more_evidence" | "produce_patch_plan" | "ask_user" | "block" | "run_verification",
  "reason": "",
  "needed_evidence": [],
  "patch_plan": []
}
```


---

# FILE: 19_PROMPTS/reviewer.md

# Prompt — Reviewer / Veto

You review a proposed patch against the task, evidence, and acceptance criteria.

Return JSON only.

Check:

- scope
- risk
- unrelated edits
- missing tests
- likely type errors
- violation of design/docs evidence

```json
{
  "decision": "approve" | "veto" | "needs_more_verification",
  "reasons": [],
  "required_checks": [],
  "risk_flags": []
}
```


---

# FILE: 19_PROMPTS/spec_critic.md

# Prompt — Spec Critic

You are the Spec Critic for Micro Mission Coder.

Your job is to decide whether implementation may begin.

Return JSON only.

Evaluate:

- measurable acceptance criteria
- missing product decisions
- missing UI states
- security/payment/PII ambiguity
- schema/migration risk
- testability

Output schema:

```json
{
  "decision": "ready" | "needs_clarification" | "needs_repo_scan" | "blocked",
  "blocking_questions": [],
  "missing_acceptance_criteria": [],
  "risk_flags": [],
  "summary": ""
}
```

Ask specific questions. Never ask “can you provide more details?”


---

# FILE: 20_REFERENCES.md

# 20 — References

These are implementation references and rationale sources.

## Spec-driven development

- GitHub Spec Kit: https://github.com/github/spec-kit
- GitHub Spec Kit spec-driven workflow: https://github.com/github/spec-kit/blob/main/spec-driven.md
- Microsoft article on Spec Kit and spec-driven development: https://developer.microsoft.com/blog/spec-driven-development-spec-kit

## Repo intelligence

- Tree-sitter official site: https://tree-sitter.github.io/
- Tree-sitter GitHub: https://github.com/tree-sitter/tree-sitter
- Language Server Protocol official site: https://microsoft.github.io/language-server-protocol/
- VS Code LSP guide: https://code.visualstudio.com/api/language-extensions/language-server-extension-guide

## Verification and frontend

- Playwright visual comparisons: https://playwright.dev/docs/test-snapshots

## Local model runtimes

- Ollama FAQ: https://docs.ollama.com/faq
- llama.cpp model management / router mode: https://huggingface.co/blog/ggml-org/model-management-in-llamacpp
- vLLM automatic prefix caching: https://docs.vllm.ai/en/latest/features/automatic_prefix_caching.html

## Coding models

- Qwen2.5-Coder technical report: https://arxiv.org/abs/2409.12186

## Notes

The implementation must not depend on any one model. The runtime is model-pluggable. Model references are defaults for evaluation and bootstrapping.

## Design system and frontend artifact references

- Open Design repository: https://github.com/nexu-io/open-design
- Open Design shadcn-ui skill: https://open-design.ai/skills/shadcn-ui/
- shadcn/ui repository: https://github.com/shadcn-ui/ui
- shadcn/ui site: https://ui.shadcn.com/
- chatcn repository: https://github.com/leonickson1/chatcn
- chatcn site: https://chatcn-iota.vercel.app/


---

# FILE: 21_OPEN_DESIGN_SHADCN_CHATCN_INTEGRATION.md

# 21 — Open Design, shadcn/ui, and chatcn Integration Addendum

## Purpose

This addendum restores and hardens the frontend design component. The system must not regress into generic AI UI. Frontend work should be driven by a dedicated Design Brain that can consume Open Design assets, shadcn/ui component patterns, chatcn chat-interface components, local app conventions, visual checks, and accessibility constraints.

## External projects to evaluate and optionally integrate

### Open Design

Repository: https://github.com/nexu-io/open-design

Open Design is a local-first, open-source Claude Design alternative. It exposes a design workflow built around Skills, Design Systems, templates, sandboxed previews, exportable artifacts, and existing coding-agent CLIs. It should be treated as a design workflow and asset source, not as the core coding harness.

### shadcn/ui

Repository: https://github.com/shadcn-ui/ui
Site: https://ui.shadcn.com/

shadcn/ui should be the default React/Tailwind component foundation when the target repo already uses React/Next/Tailwind or has no competing design system. It is open-source/open-code and intended to be customized into an owned component library.

### chatcn

Repository: https://github.com/leonickson1/chatcn
Site: https://chatcn-iota.vercel.app/

chatcn should be treated as an optional chat-surface component library for agent/chat UI work. It is built on shadcn/ui and Tailwind. Use it only when the product surface includes chat, threads, attachments, reactions, or agent conversation UI.

## Non-negotiable design rule

Do not pipe Open Design, shadcn/ui, or chatcn catalogs directly into small model context.

The Design Brain must compile a tiny `DesignPacket` for each task. The packet may reference selected skills, selected components, selected design-system rules, and selected screenshots. It must not dump entire design libraries.

## OpenDesignAdapter responsibilities

Implement an optional `OpenDesignAdapter` service under `src/core/design-brain/adapters/open-design/`.

The adapter must:

1. Detect whether Open Design is installed or vendored.
2. Index available Open Design Skills, Design Systems, templates, and example artifacts.
3. Select at most one primary design system per task unless the user explicitly asks for alternatives.
4. Select at most three skills per task.
5. Extract compact rules from `DESIGN.md`/Skill files into the local DesignPacket.
6. Never expose the full Open Design tool catalog to the coding model.
7. Keep all Open Design use outside the hot coding path unless the task is explicitly frontend/design/artifact work.
8. Cache generated design briefs and selected rules in `.mission/design/`.
9. Export artifacts into the mission artifact store, not arbitrary project locations.
10. Mark all generated design artifacts as draft until verified by the frontend verifier.

## Design Brain upgraded data sources

The Design Brain should consider these sources in priority order:

1. Existing application design system and components.
2. Existing `DESIGN.md`, tokens, Tailwind config, CSS variables, theme files.
3. Local component inventory from Repo Brain.
4. shadcn/ui base patterns, only if compatible with the app stack.
5. chatcn patterns, only for chat surfaces.
6. Selected Open Design design system/skill/template.
7. User-provided screenshots, wireframes, or brand references.

Existing repo conventions beat Open Design defaults. Do not introduce a new visual language into an established product unless the spec explicitly calls for a redesign.

## Design workflow

For frontend/design tasks, use this pipeline:

```text
User prompt/spec
  ↓
Spec Brain extracts UI intent and missing design constraints
  ↓
Design Brain detects stack and existing design system
  ↓
OpenDesignAdapter optionally selects design system/skills/templates
  ↓
Design Brain builds compact DesignPacket
  ↓
Coder generates patch using allowed components/tokens only
  ↓
Harness starts app/story route
  ↓
Playwright checks DOM, console, network, responsive viewports
  ↓
Screenshot artifacts saved
  ↓
Optional VLM/design critic answers narrow visual questions
  ↓
Confidence Engine accepts/retries/escalates
```

## DesignPacket v2 required fields

```json
{
  "packet_version": "design-packet-v2",
  "task_id": "T-frontend-001",
  "ui_surface": "dashboard | landing | form | chat | settings | report | auth | other",
  "primary_design_source": "existing_repo | shadcn_ui | chatcn | open_design | user_reference",
  "component_library": "existing | shadcn/ui | chatcn | custom",
  "open_design": {
    "enabled": false,
    "selected_system": null,
    "selected_skills": [],
    "selected_template": null,
    "brief_id": null
  },
  "tokens": {
    "colors": {},
    "typography": {},
    "spacing": {},
    "radius": {},
    "shadows": {}
  },
  "allowed_components": [],
  "forbidden_components": [],
  "required_states": ["loading", "empty", "error", "success"],
  "viewports": ["390x844", "768x1024", "1440x900"],
  "accessibility_rules": [],
  "interaction_rules": [],
  "visual_references": [],
  "anti_patterns": [],
  "verification_questions": []
}
```

## Chat UI policy

When the requested surface includes chat, agent messages, conversation history, file attachments, threads, code blocks, reactions, or streaming responses:

1. Use existing app chat components first.
2. If none exist and the stack is React/Tailwind/shadcn-compatible, allow chatcn as a candidate source.
3. Require message states: empty, loading/streaming, sent, failed, retrying, attachment uploading, code block rendering.
4. Require keyboard navigation and screen-reader labels for message actions.
5. Require overflow/scroll behavior checks on mobile and desktop.
6. Require long-message and code-block visual checks.

## Open Design usage modes

### Mode 1 — Reference only

Use Open Design as a source of design-system rules, templates, and checklists. No external design generation run.

Use when:

- hardware is constrained;
- the target app already has a design system;
- the task is a small UI change.

### Mode 2 — Prototype generation

Use Open Design to generate a standalone prototype or design artifact, then translate selected pieces into the target repo.

Use when:

- the user asks for a new screen, landing page, deck, dashboard, or prototype;
- no existing product design system exists;
- the task benefits from multiple visual directions.

### Mode 3 — Design critique

Use Open Design-style critique/checklists to score an existing patch or screenshot.

Use when:

- frontend verifier finds no hard failure, but design quality is questionable;
- user asks for polish;
- design confidence is low.

## Context budget rules

For 16GB hardware:

- Open Design: reference-only mode.
- Max selected skills: 1.
- Max design-system excerpt: 600 tokens.
- No VLM by default.

For 24–32GB hardware:

- Open Design: reference-only or prototype mode for small screens.
- Max selected skills: 2.
- Max design-system excerpt: 900 tokens.
- Tiny VLM optional and cold-loaded.

For 48–64GB hardware:

- Open Design: full prototype/critique mode allowed.
- Max selected skills: 3.
- Max design-system excerpt: 1,500 tokens.
- VLM and Playwright visual loops allowed by scheduler.

## Acceptance criteria for this integration

- `DesignPacketV2` is generated for every frontend task.
- `OpenDesignAdapter` never exposes full Open Design catalogs to model context.
- shadcn/ui is used only when stack-compatible and not in conflict with existing app conventions.
- chatcn is used only for chat surfaces or agent-conversation UI.
- Every frontend patch has DOM, console, network, and viewport checks.
- Visual artifacts are written to `.mission/artifacts/visual/`.
- The Confidence Engine includes a design confidence subscore.

## Implementation tickets

1. Add `OpenDesignAdapter` interface.
2. Add Open Design asset indexer.
3. Add `DesignPacketV2` schema.
4. Add shadcn/ui component inventory importer.
5. Add chatcn component-source policy.
6. Add design brief preprocessor.
7. Add design-system selector.
8. Add frontend verification questions generator.
9. Add design confidence scoring.
10. Add artifact storage for screenshots/prototypes.

## Do not do

- Do not make Open Design the core harness.
- Do not use MCP in the hot path for Open Design.
- Do not dump Open Design Skills/Systems catalogs into small model context.
- Do not use shadcn/ui as an excuse to ignore existing app components.
- Do not treat VLM aesthetic judgment as truth.
- Do not let generated prototypes bypass patch verification.


---

# FILE: README.md

# Micro Mission Coder — Agentic Builder Spec Pack

Generated: 2026-05-28

This pack is a builder-ready specification for **Micro Mission Coder**: a local, mission-driven, context-disciplined coding system designed to make compact coding models useful on modest hardware.

The goal is not to clone a frontier model. The goal is to make long-horizon local coding possible through:

- durable mission state
- spec-first execution
- fresh Repo Brain evidence
- tiny context packets
- patch-only editing
- deterministic verification
- hardware-aware model orchestration
- optional vision/design checks
- sparse expert escalation

## Build target

Primary target: **24–32GB RAM**, 1TB SSD, optional 8GB GPU.

Enhanced target: **64GB RAM** with optional stronger local coder.

Constrained target: **16GB RAM** with reduced feature activation.

## How to use this pack with an agentic builder

1. Give the builder `05_AGENTIC_BUILDER_INSTRUCTIONS.md` first.
2. Then give it `00_EXECUTIVE_BRIEF.md`, `01_PRODUCT_REQUIREMENTS.md`, and `02_SYSTEM_ARCHITECTURE.md`.
3. Ask it to implement Phase 0 and Phase 1 from `03_BUILD_PHASES_AND_MILESTONES.md`.
4. Use `13_TASK_TICKETS.md` as the ticket backlog.
5. Use `14_ACCEPTANCE_TESTS.md` as the non-negotiable validation suite.
6. Use the JSON schemas in `07_SCHEMAS/` as implementation contracts.

## Non-negotiable architectural rules

- No MCP in the hot path. Optional adapters may exist outside the core runtime.
- No model gets broad repo access.
- If Repo Brain is stale, execution blocks until refresh completes.
- The coder never bypasses Repo Brain and searches the repository directly.
- No implementation begins without acceptance criteria.
- All code changes must be patch-only and verifier-gated.
- Confidence is computed from evidence, tests, and risk signals, not model self-belief.
- Parallelism is bounded by hardware policy and file-lock safety.
- Vision models are cold-loaded and used only after deterministic UI checks.

## Directory map

```text
00_EXECUTIVE_BRIEF.md
01_PRODUCT_REQUIREMENTS.md
02_SYSTEM_ARCHITECTURE.md
03_BUILD_PHASES_AND_MILESTONES.md
04_HARDWARE_PROFILES.md
05_AGENTIC_BUILDER_INSTRUCTIONS.md
06_COMPONENT_SPECS/
07_SCHEMAS/
08_API_CONTRACTS.md
09_DATABASE_SCHEMA.md
10_CLI_SPEC.md
11_RUNTIME_CONFIG_EXAMPLE.yaml
12_MODEL_PROFILES.yaml
13_TASK_TICKETS.md
14_ACCEPTANCE_TESTS.md
15_SECURITY_AND_SANDBOXING.md
16_FRONTEND_DESIGN_VERIFICATION.md
17_EVALUATION_PLAN.md
18_RISKS_AND_DECISIONS.md
19_PROMPTS/
20_REFERENCES.md
FULL_SPEC_SINGLE_FILE.md
handoff_manifest.json
```

## Design integration update

This v2 pack restores the design subsystem explicitly:

- Open Design adapter for selected Skills/Systems/templates.
- shadcn/ui policy for React/Tailwind component foundations.
- chatcn policy for chat/agent-conversation surfaces.
- DesignPacketV2 schema.
- Playwright-first verification and optional VLM/design critic.

Open Design is not used as the main harness and is not exposed through a hot-path MCP/tool catalog. It is compiled into small DesignPacket excerpts.


---

# FILE: handoff_manifest.json

```json
{
  "name": "Micro Mission Coder Spec Pack",
  "generated_at": "2026-05-28",
  "primary_target_hardware": "24-32GB RAM, 1TB SSD, optional 8GB GPU",
  "architecture_rules": [
    "No MCP hot path",
    "Repo Brain stale blocks code generation",
    "No direct repo search by coder",
    "Patch-only editing",
    "Mission Ledger is source of truth",
    "Hardware profiles control activation",
    "Verification decides acceptance"
  ],
  "build_order": [
    "CLI/config/storage",
    "Mission Ledger",
    "Spec Compiler",
    "Repo Brain Lite",
    "Context Governor",
    "Model Provider",
    "Patch Harness",
    "Verifier",
    "Confidence Engine",
    "Docs/Design/Playwright"
  ],
  "files": [
    "00_EXECUTIVE_BRIEF.md",
    "01_PRODUCT_REQUIREMENTS.md",
    "02_SYSTEM_ARCHITECTURE.md",
    "03_BUILD_PHASES_AND_MILESTONES.md",
    "04_HARDWARE_PROFILES.md",
    "05_AGENTIC_BUILDER_INSTRUCTIONS.md",
    "06_COMPONENT_SPECS/CONFIDENCE_ENGINE.md",
    "06_COMPONENT_SPECS/CONTEXT_GOVERNOR.md",
    "06_COMPONENT_SPECS/DESIGN_BRAIN.md",
    "06_COMPONENT_SPECS/DOCS_BRAIN.md",
    "06_COMPONENT_SPECS/ESCALATION_ENGINE.md",
    "06_COMPONENT_SPECS/MISSION_BRAIN.md",
    "06_COMPONENT_SPECS/MODEL_ORCHESTRATOR.md",
    "06_COMPONENT_SPECS/PATCH_HARNESS.md",
    "06_COMPONENT_SPECS/REPO_BRAIN.md",
    "06_COMPONENT_SPECS/SPEC_BRAIN.md",
    "06_COMPONENT_SPECS/TASK_SCHEDULER.md",
    "06_COMPONENT_SPECS/TRACE_STORE.md",
    "06_COMPONENT_SPECS/VERIFIER.md",
    "07_SCHEMAS/attempt.schema.json",
    "07_SCHEMAS/confidence.schema.json",
    "07_SCHEMAS/evidence_packet.schema.json",
    "07_SCHEMAS/hardware_profile.schema.json",
    "07_SCHEMAS/mission.schema.json",
    "07_SCHEMAS/model_registry.schema.json",
    "07_SCHEMAS/phase_packet.schema.json",
    "07_SCHEMAS/spec.schema.json",
    "07_SCHEMAS/task_graph.schema.json",
    "08_API_CONTRACTS.md",
    "09_DATABASE_SCHEMA.md",
    "10_CLI_SPEC.md",
    "11_RUNTIME_CONFIG_EXAMPLE.yaml",
    "12_MODEL_PROFILES.yaml",
    "13_TASK_TICKETS.md",
    "14_ACCEPTANCE_TESTS.md",
    "15_SECURITY_AND_SANDBOXING.md",
    "16_FRONTEND_DESIGN_VERIFICATION.md",
    "17_EVALUATION_PLAN.md",
    "18_RISKS_AND_DECISIONS.md",
    "19_PROMPTS/bug_analyst.md",
    "19_PROMPTS/design_critic.md",
    "19_PROMPTS/docs_summarizer.md",
    "19_PROMPTS/patch_writer.md",
    "19_PROMPTS/planner.md",
    "19_PROMPTS/reviewer.md",
    "19_PROMPTS/spec_critic.md",
    "20_REFERENCES.md",
    "FULL_SPEC_SINGLE_FILE.md",
    "README.md"
  ],
  "updated_files_v2": [
    "21_OPEN_DESIGN_SHADCN_CHATCN_INTEGRATION.md",
    "06_COMPONENT_SPECS/OPEN_DESIGN_ADAPTER.md",
    "07_SCHEMAS/design_packet.v2.schema.json"
  ],
  "design_integration": {
    "open_design": "optional Design Brain adapter, not core harness",
    "shadcn_ui": "default React/Tailwind component foundation when compatible",
    "chatcn": "optional chat-surface component library built on shadcn/ui",
    "hot_path_rule": "no MCP/tool catalog/context dump; compile DesignPacketV2"
  },
  "version": "+design-v2"
}
```
