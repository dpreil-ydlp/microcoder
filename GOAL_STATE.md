# Microcoder Goal State

Status: `goal_complete`

## Goal

Build the full Microcoder runtime described by `micro_mission_coder_specs/`: a local chat-to-build coding system with build state, spec gates, Repo Brain evidence, budgeted phase packets, model routing, patch-only editing, verifier-gated acceptance, confidence scoring, docs/design support, bounded scheduling, escalation, and benchmark export.

## Completion Contract

The goal is `goal_complete` only when all of these are true:

- The CLI contract in `10_CLI_SPEC.md` is implemented.
- SQLite tables in `09_DATABASE_SCHEMA.md` initialize idempotently.
- JSON schemas in `07_SCHEMAS/` validate generated runtime artifacts.
- Acceptance tests A-H in `14_ACCEPTANCE_TESTS.md` have automated coverage or a hard, explicit blocked status where external runtime dependencies are absent.
- Patch application is scope-checked, patch-only, logged, and verifier-gated.
- Repo Brain stale state blocks code generation and regenerates evidence after refresh.
- Hardware profile policy changes runtime behavior.
- Frontend tasks receive `DesignPacketV2` before patch generation.
- Docs Brain can include configured web research with source URLs, snippets, status, and failure reasons so small local models do not rely only on stale parametric memory.
- Trace exports can replay build/spec/evidence/phase/model/patch/verification/confidence decisions.
- The benchmark runner exports raw-model vs MMC comparison artifacts.
- A terminal build console gives the runtime a usable operator surface.

## Reliable Evidence

- Fresh command output from `npm test`, `npm run typecheck`, and CLI smoke commands.
- Generated `.mission/` artifacts from test workspaces.
- SQLite row checks against the schema contract.
- JSON schema validation results for generated fixtures.

## Scaffolding Evidence

- Static module existence without tests.
- Placeholder provider responses.
- Commands that report unsupported external tools without exercising the gate.

## Current Iteration

Implemented runtime modules across phases 0-9 with automated coverage and CLI smoke proof. The latest iteration converts the user-facing console from mission language to build language, adds `microcoder build ...` and `/build ...` commands while preserving legacy aliases, adds visible build progress breadcrumbs, fixes active-build chat behavior for new object-bearing goals, adds an `interface` model route with `liquid-lfm2-1.2b` as an explicit llama.cpp candidate, adds quiet chat-time web standards context so normal build briefs can use current references without dumping search noise into the TUI, hardens the repo-owned browser PTY into the primary proof surface when native Terminal automation is blocked, adds a brutal deterministic conversation UAT gauntlet for the chat/build interface, teaches standard todo-list requests to compile with sane defaults instead of asking vague clarification questions, and adds `microcoder eval chat-lab` for autonomous transcript checking without manual copy-paste.

Latest verification:

- `ALLOW_MISSING_STAGES=0 bash /Users/davidpreil/.ai/skills/brutal-test-gauntlet/scripts/run_gauntlet.sh` passes 9/9 stages: lint, typecheck, unit, contract, integration, e2e, smoke, UAT, regression. Latest report: `gauntlet-report.md`, run time `2026-05-31T19:45:16Z`.
- `npm test` passes: 77 tests.
- `npm run typecheck` passes.
- `npm run lint` passes.
- `npm run build` passes.
- `npm run test:smoke`, `npm run test:uat`, `npm run test:uat:cli`, `npm run test:uat:browser`, `npm run test:uat:launcher`, and `npm run test:e2e` pass against the build-console launcher and web PTY.
- `npm run chat:lab` passes and writes autonomous transcript artifacts under `.gauntlet/chat-lab/2026-05-31T19-42-41-490Z/`, including `report.md` and per-scenario transcripts for todo-list defaults and stale vague-state replacement.
- Latest `npm run test:uat` proof bundle: `.gauntlet/uat/2026-05-31T19-45-45-852Z/`. It contains `conversation-uat-report.json`, `conversation-uat-report.md`, per-case command/stdout/stderr artifacts, `browser-pty/web-pty-proof.json`, `browser-pty/web-pty-transcript.txt`, `browser-pty/web-pty-final.png`, and `browser-pty/web-pty-server-output.txt`; the report shows 20/20 UAT cases passing, including `build me a todo list` and stale vague-state replacement.
- Latest `npm run test:e2e` proof bundle: `/var/folders/zl/kl6722r51g5_k5v9dzhqxjph0000gn/T/microcoder-web-e2e-2xZcLI/.mission/proof/web-pty/`. It contains `web-pty-proof.json`, `web-pty-transcript.txt`, and `web-pty-final.png`; the JSON reports `reason=tui_exit`, `alive=false`, `exit_code=0`, generated artifacts, and browser-driven inputs `what can you do?`, `snake game`, `what are we building?`, `build it`, `/exit`.
- Computer Use could not control Ghostty, iTerm, or Terminal because those app bundles are blocked by the plugin. Computer Use did validate the repo-owned real PTY in Microsoft Edge at `http://127.0.0.1:4192`: `hi` returned the short greeting, `snake game` compiled a spec, `what is the spec?` printed requirements and acceptance criteria, `build it` started build `M-21688480`, `make snake` compiled a new brief without swallowing it into the active build, `/build step` displayed build progress lines and recorded failed attempt `A-832ba7c3` with confidence `55`, and `/exit` ended the PTY with `exited:0`.
- Generated proof artifacts from the Computer Use PTY run live under `/private/var/folders/zl/kl6722r51g5_k5v9dzhqxjph0000gn/T/tmp.PQeZhRqscx/.mission/`, including `specs/S-696f6151.json`, `specs/S-2c9ae78b.json`, `artifacts/A-832ba7c3.patch`, `attempts.jsonl`, and worktree `worktrees/T1-A-832ba7c3/`.
- `microcoder web search "MDN canvas keyboard events"` returns `web_status READY` with 5 live DuckDuckGo HTML results, including MDN KeyboardEvent.
- `node bin/microcoder.js doctor` reports `web_research_enabled true`, `web_research_auto_include_in_docs true`, `web_research_auto_include_in_chat true`, and `web_research_provider duckduckgo_html`.
- Manual live chat proof in `/tmp/microcoder-tui-proof-mncGVY`: `what can you do?` returned one short conversational line, `snake game` returned a clean build-plan reply with no IDs or paths, and `what are we building?` printed the human-readable plan. Manual live search proof in `/tmp/microcoder-chat-proof-4QSJM2` saved DuckDuckGo source notes under `.mission/chat/spec-chat.md` while still compiling spec `S-53205662`.
- Post-run process cleanup check has no remaining `mmc-pty-web-console`, `microcoder.js web`, `fake-llama-server`, or `llama-server` matches.

Earlier accumulated verification:

- `node dist/src/cli/mmc.js init` creates config, `.mission/`, and SQLite DB.
- `node dist/src/cli/mmc.js doctor` reports environment and hardware profile.
- `node dist/src/cli/mmc.js eval validate` passes artifact/schema consistency checks.
- `node dist/src/cli/mmc.js tui --snapshot` renders the mission console from real `.mission` state, task progress, repo freshness, model routes, and latest attempts.
- `printf '/mission status\n/models\n/exit\n' | node dist/src/cli/mmc.js tui` exercises the non-interactive Droid-style command path.
- A real PTY session ran `node dist/src/cli/mmc.js tui`, accepted `/mission status`, `/models`, rejected `/probe-extra test_writer`, accepted `/mission validate`, and exited cleanly with `/exit`.
- `node dist/src/cli/mmc.js tui web --port 4184` launched the repo-owned web PTY console in `tools/mmc-pty-web-console.py`; Computer Use drove Microsoft Edge against it, sent `/index`, clicked `/models`, clicked the bad-prefix check for `/probe-extra test_writer`, clicked `/mission validate`, clicked `/mission status`, and clicked `/exit`. The PTY showed `repo: fresh`, the planned model routes, `Unknown TUI command. Use /help.`, validation status `pass`, `303 artifact rows resolve`, and browser state `exited:0`. The `mmc tui web` process then exited by itself and left no validation server running.
- `node dist/src/cli/mmc.js spec create "make the dashboard better"` exits 2 with targeted clarification questions.
- `node dist/src/cli/mmc.js mission start` exits 2 and refuses to start implementation for that vague spec.
- The planned Ollama-side model fleet is installed: `smollm2:360m`, `gemma3:1b`, `qwen2.5-coder:3b`, `qwen2.5-coder:7b`, `phi4-mini`, and `moondream`.
- The current `middle_32gb` profile routes `spec_critic`, `planner`, and `reviewer` to `gemma3:1b`, routes `code_writer` to `qwen2.5-coder:7b`, routes `test_writer` to `phi4-mini`, and leaves `visual_inspector` disabled by default.
- `node dist/src/cli/mmc.js models list` reports all routed roles, including `test_writer: phi4-mini` and `visual_inspector: null`.
- `node dist/src/cli/mmc.js models probe spec_critic|planner|code_writer|reviewer|test_writer` returns `OK` through the live Ollama provider.
- Frontend fixture verification ran after patch application in an isolated worktree; Playwright loaded `http://127.0.0.1:4173`, captured a screenshot/log artifact, and the attempt reached confidence `99 accept`.
- `node dist/src/cli/mmc.js eval benchmark --count 20` ran a live local paired benchmark (`bench-1780039728527`). Raw `qwen2.5-coder:0.5b` vs MMC: localization `0.55` vs `1.0`, unrelated edits avoided `0.55` vs `1.0`, patch apply rate `0` vs `1.0`.
- `node dist/src/cli/mmc.js eval benchmark --source current-repo --count 20` ran a harder verifier-backed benchmark on 19 eligible real source files (`bench-1780041058410`). Raw literal patch apply `0`; MMC localization `1.0`, patch apply `1.0`, expected-change verification `1.0`, and typecheck pass `1.0`.
- `node dist/src/cli/mmc.js eval validate` passes after benchmark and frontend artifacts: 303 artifact rows resolve.

## Remaining

- No blocker remains for the documented phase 0-9 runtime goal.
- Future work is product depth, not completion proof: broader non-comment behavioral benchmarks, richer repair loops, and more provider adapters.
