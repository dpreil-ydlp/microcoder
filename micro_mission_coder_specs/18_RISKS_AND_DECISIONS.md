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
