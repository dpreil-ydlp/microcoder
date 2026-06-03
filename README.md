# Microcoder

Microcoder is a local chat-to-build coding runtime built from the spec pack in `micro_mission_coder_specs/`.

It is not a toy chat wrapper. The CLI turns conversation into a buildable spec, gates vague work before implementation, builds Repo Brain evidence, applies model patches through a harness, runs verification, scores confidence, and records trace artifacts.

## Commands

```bash
npm install
npm run build
npm test
npm link

microcoder
microcoder web --port 4180
microcoder web search "MDN canvas keyboard events"
microcoder eval chat-lab
microcoder eval build-lab
microcoder eval validate

microcoder init
microcoder doctor
microcoder chat "I want to build a CRM for freelance designers"
microcoder chat status
microcoder setup web --enabled true --auto true --chat true
microcoder spec create "Add a billing dashboard that shows recent invoices"
microcoder build start
microcoder build step
microcoder build run
microcoder build validate
microcoder repo index
microcoder task next
microcoder run --task T1
microcoder patch apply --attempt A-123
microcoder models list
microcoder models status
microcoder models set code_writer qwen2.5-coder:3b
microcoder models clear code_writer
microcoder models profile constrained_16gb
microcoder models probe code_writer
microcoder setup backend llamacpp --server /opt/homebrew/bin/llama-server --model code_writer=/models/coder.gguf --auto-start true --select
microcoder backend status code_writer
microcoder backend start code_writer
microcoder backend stop
microcoder eval benchmark --source current-repo --count 20
```

## Status

Current goal status is tracked in `GOAL_STATE.md`.

The runtime has working coverage for CLI/config/storage, spec and build gates, Repo Brain freshness, context packets, model provider routing, patch scope enforcement, verifier commands, confidence scoring, docs/design packet generation, Open Design selection limits, escalation loop detection, artifact recording, and consistency validation.

The TUI is a chat-first local build console. Run `microcoder`, then talk normally about what you want to build. Microcoder keeps the current app brief in `.mission/chat/` for compatibility, asks for missing product details, writes a draft app brief, and compiles a buildable spec when the conversation has enough goal, user, workflow, and acceptance detail. Use slash commands like `/chat status`, `/chat reset`, `/build status`, `/build spec <goal>` for direct compile, `/build start`, `/build step`, `/build run`, `/models`, `/models set code_writer qwen2.5-coder:3b`, `/patch apply <attempt-id>`, and `/build validate`. Legacy `/mission ...` commands still work as compatibility aliases. For browser-operated validation, run `microcoder web --port 4180` and open the printed localhost URL; it drives the same chat/TUI through a real PTY.

The web PTY is the preferred validation surface when native Terminal automation is blocked. It exposes local-only `/health`, `/output`, `/artifacts`, and `/transcript` endpoints, uses a per-run token for `/send`, records browser-driven input/output, lists generated `.mission` artifacts, writes `web-pty-proof.json` and `web-pty-transcript.txt` when `MMC_WEB_TUI_PROOF_DIR` is set, and exits the inner TUI process cleanly. `npm run test:e2e` drives this surface through Playwright: it asks normal chat questions, compiles a Snake build plan, inspects the plan, starts the build, captures a screenshot, verifies proof artifacts, and checks that the PTY process is gone.

`npm run test:uat` is the canonical user-acceptance gauntlet for the chat/build interface. It runs deterministic CLI conversation cases plus the real browser PTY flow, writes per-case stdout/stderr/command artifacts under `.gauntlet/uat/<run-id>/cases/`, and writes browser proof under `.gauntlet/uat/<run-id>/browser-pty/`. Narrow runners are available as `npm run test:uat:cli`, `npm run test:uat:browser`, and `npm run test:uat:launcher`.

`microcoder eval chat-lab` is the fast autonomous transcript checker. It plays through realistic terminal conversations in temporary workspaces, rejects known bad response patterns, and writes transcript/report artifacts under `.gauntlet/chat-lab/<run-id>/`. Use it when you want to quickly see whether the chat surface is acting sane without manually copy-pasting prompts.

`microcoder eval build-lab` is the broader autonomous build battery. It asks Microcoder to shape 29 prompt briefs, including standard apps, modifier-heavy requests, unseen game variants, tracker/list collisions, and fail-closed external/security risks, then runs seeded patch/apply/verify builds for an existing bugfix and a UI style improvement. Reports and transcripts are written under `.gauntlet/build-lab/<run-id>/`.

Web research is first-class context for the small local models. `microcoder web search "<query>"` fetches source links and snippets through the configured provider. `web_research.auto_include_in_chat` quietly checks standard product and UX references while shaping the app brief, and `web_research.auto_include_in_docs` injects results into the DocsPacket used during code generation. The TUI keeps the visible conversation short; source notes are saved with the draft brief. The default provider is DuckDuckGo HTML search; tests use fake local HTTP endpoints, so the default suite does not depend on live internet.

`microcoder models status` is the operator model picker: it shows the active route per role, why that route is active, and the available choices with provider/state/RAM/context details. `microcoder models set <role> <model|disabled>` pins a route; `microcoder models clear <role>` returns it to the hardware profile policy. The `interface` role is reserved for the end-user conversational layer; it defaults to `gemma3:1b`, and `liquid-lfm2-1.2b` is available as an explicit llama.cpp route once a GGUF path is configured.

Ollama remains the default backend. llama.cpp is an optional first-class backend that uses a local OpenAI-compatible `llama-server`; microcoder does not fork llama.cpp and does not bundle model weights. Configure it with:

```bash
microcoder setup backend llamacpp \
  --server /absolute/path/to/llama-server \
  --model code_writer=/absolute/path/to/model.gguf \
  --auto-start true \
  --select
```

`microcoder doctor` reports `llamacpp_status` as `READY`, `NO_MODEL_BACKEND`, `MISSING_BINARY`, `MISSING_MODEL`, `SERVER_START_FAILED`, or `MODEL_PROBE_FAILED`. `microcoder models list` includes backend/provider/model path routing. `microcoder models probe code_writer` uses llama.cpp when selected, starts the managed server when `auto_start` is true, and stops a server it started when `auto_stop_after_request` is true. There is no fallback from llama.cpp to Ollama unless `models.allow_provider_fallback` is explicitly true.

`microcoder run --task T1` generates and verifies a patch in an isolated worktree. Accepted patches are promoted into the checkout explicitly with `microcoder patch apply --attempt A-123`.

Frontend browser verification is implemented as an optional configured runner. It reports a blocked verifier result unless `verification.app_start_command` and `verification.app_url` are configured, because screenshots without a real app target are fake proof.

The current model registry follows the spec fleet with runnable local tags:

- `smollm2:360m`
- `gemma3:1b`
- `qwen2.5-coder:3b`
- `qwen2.5-coder:7b`
- `phi4-mini`
- `moondream`
- `liquid-lfm2-1.2b` as an optional llama.cpp interface route

Current `middle_32gb` routing is `gemma3:1b` for interface/spec/planning/review, `qwen2.5-coder:7b` for code writing, `phi4-mini` for test writing, and visual inspection disabled by default.

The `liquid-lfm2-1.2b` entry remains a llama.cpp provider entry; it is not routed by default until a local llama.cpp-compatible server is configured or the `interface` role is explicitly pinned to it. The latest full proof run, `bench-1780060681423`, used live Ollama routing and covered 20 current-repo source files with MMC patch apply and verification pass rates at `1.0`.
