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
