# Phase 0-1 Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable Micro Mission Coder vertical slice from the spec pack: CLI/config/storage plus mission/spec compilation and clarification blocking.

**Architecture:** A Node/TypeScript CLI drives small deterministic modules for config, SQLite migrations, schema validation, spec compilation, mission ledger persistence, and trace events. Phase 2+ commands exist only as explicit blocked/stub surfaces so users do not mistake them for implemented patch/model behavior.

**Tech Stack:** TypeScript, Node.js 20+, SQLite CLI, YAML, AJV, Vitest.

---

### Task 1: CLI Skeleton

**Files:**
- Create: `src/cli/mmc.ts`
- Create: `src/cli/run.ts`
- Create: `package.json`
- Create: `tsconfig.json`

- [x] Implement `mmc --help`, `mmc init`, `mmc doctor`, `mmc spec create`, `mmc spec compile`, `mmc mission start`, and contract-visible later-phase commands.
- [x] Verify: command parser tests cover help/init/spec/mission flows.

### Task 2: Config, Hardware, and SQLite

**Files:**
- Create: `src/core/config/defaults.ts`
- Create: `src/core/config/config.ts`
- Create: `src/core/hardware/profile.ts`
- Create: `src/core/storage/sqlite.ts`

- [x] Implement default YAML config creation, validation, hardware profile mapping, and idempotent SQLite migrations matching `09_DATABASE_SCHEMA.md`.
- [x] Verify: tests cover missing config defaults, invalid profile validation, and idempotent migrations.

### Task 3: Schema Fixtures and Validation

**Files:**
- Create: `src/core/schemas/validator.ts`
- Create: `src/core/schemas/fixtures.ts`

- [x] Load authoritative JSON schemas from `micro_mission_coder_specs/07_SCHEMAS`.
- [x] Verify: all schema fixture objects validate through AJV.

### Task 4: Spec Brain and Mission Ledger

**Files:**
- Create: `src/core/spec/compiler.ts`
- Create: `src/core/mission/ledger.ts`
- Create: `src/core/trace/events.ts`

- [x] Compile rough prompts, Markdown, and JSON specs into schema-valid compiled specs, blocking questions, and acyclic task graphs.
- [x] Start missions only when acceptance criteria exist; vague specs block with specific questions and exit code 2.
- [x] Verify: acceptance tests A/B are covered.
