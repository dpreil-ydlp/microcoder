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
