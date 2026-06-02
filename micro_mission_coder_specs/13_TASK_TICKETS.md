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
