# Acceptance Matrix

Status labels:

- `covered`: automated test or CLI smoke covers the behavior.
- `implemented`: code path exists, but external runtime setup may be required.
- `blocked`: code reports a hard blocked status instead of pretending success.

| Spec Item | Status | Evidence |
|---|---|---|
| A1 CLI skeleton | covered | `mmc --help`, `mmc init`, command parsing tests |
| A2 Config loader | covered | missing config defaults and invalid config tests |
| A3 SQLite storage | covered | idempotent migration test |
| B1 Mission Ledger | covered | `mission start`, `task next`, attempts JSONL/DB tests |
| B2 Spec ingestion | covered | prompt, Markdown, JSON spec tests |
| B3 Clarification gate | covered | vague dashboard request exits 2 with targeted questions |
| B4 Task graph | covered | acyclic linked task graph tests |
| C Repo Brain freshness | covered | index, stale detection, refresh-before-run path |
| D Context/model routing | covered | PhasePacket schema validation and mock/provider paths |
| E Patch Harness/Verifier | covered | scope rejection, isolated patch apply, verifier-gated accept/fail |
| F Docs/Design | covered | DocsPacket, DesignPacketV2, Open Design capped selection |
| G Frontend verification | covered | fixture app route loaded with Playwright after patched worktree; screenshot/log artifact recorded |
| H Scheduler/escalation | covered | dependency next-task selection, wave scheduler module, loop escalation tests |
| I Evaluation | covered | generated benchmark plus verifier-backed current-repo benchmark exported raw-vs-MMC rows and metrics |

Latest generated benchmark evidence: `bench-1780039728527` compared raw `qwen2.5-coder:0.5b` prompting against MMC runtime support on 20 generated repo tasks.

- Correct localization: raw `0.55`, MMC `1.0`
- Unrelated edits avoided: raw `0.55`, MMC `1.0`
- Patch apply rate: raw `0`, MMC normalized patch path `1.0`

Latest current-repo benchmark evidence: `bench-1780041058410` used live `qwen2.5-coder:7b` through Ollama on 19 eligible real source files from this repo.

- Correct localization: raw `1.0`, MMC `1.0`
- Unrelated edits avoided: raw `1.0`, MMC `1.0`
- Literal raw patch apply rate: `0`
- MMC normalized patch apply rate: `1.0`
- MMC expected-change plus typecheck verification pass rate: `1.0`

The current-repo benchmark is intentionally verifier-backed: each accepted MMC row applies the candidate in a temp copy, confirms the expected marker exists, symlinks the repo dependency install for realistic TypeScript resolution, and runs typecheck against the patched copy.
