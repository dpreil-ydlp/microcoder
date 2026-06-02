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
