# Model Orchestrator Spec

## Responsibility

Manage model providers, routing, load/offload, context limits, and model role assignments.

## Model states

| State | Policy |
|---|---|
| hot | keep loaded if hardware permits |
| warm | keep during active mission or for TTL |
| cold | load on demand, unload after use |
| remote | use only under escalation policy |

## Required providers

- OpenAI-compatible HTTP
- Ollama
- llama.cpp server/router
- optional vLLM

## Required functions

- `listModels()`
- `loadModel(modelId)`
- `unloadModel(modelId)`
- `generate(request)`
- `routeByRole(role, hardwareProfile)`
- `enforceContextLimit(modelId, packet)`
- `recordLatencyAndMemory()`

## Rules

- Never load VLM speculatively in constrained or middle mode.
- Do not run two heavy code models at once in middle mode.
- Keep controller hot only if memory pressure is low.
- Unload cold models after phase completion.
