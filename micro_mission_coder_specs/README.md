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
