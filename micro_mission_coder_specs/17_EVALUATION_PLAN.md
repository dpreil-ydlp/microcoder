# 17 — Evaluation Plan

## Main question

Does Micro Mission Coder outperform raw local model prompting on real repo tasks under the same hardware constraints?

## Baselines

A. Raw local coder prompt.
B. Local coder + hand-fed files.
C. Local coder + Repo Brain only.
D. Full Micro Mission Coder.
E. Optional strong local model inside Micro Mission Coder.

## Benchmark set

Create 20–50 tasks:

- small bugfix
- add test
- TypeScript error fix
- API route change
- form field addition
- frontend responsive fix
- component extraction
- library usage fix
- simple refactor
- spec-to-implementation mission

## Metrics

| Metric | Definition |
|---|---|
| correct localization | selected files include needed edit location |
| patch apply rate | generated patch applies cleanly |
| verification pass rate | configured checks pass |
| unrelated edits | patch touches files outside task scope |
| clarification quality | vague task yields useful question |
| context tokens used | total prompt tokens per successful task |
| mission completion | multi-task spec completed correctly |
| human intervention count | number of user clarifications/escalations |
| latency | wall-clock time per task |
| machine pressure | RAM/CPU/GPU peak |

## Required comparison

The system should be killed or simplified if full runtime does not beat raw local model on repo tasks.

## Trace exports

Each benchmark run must export:

- task spec
- evidence packets
- prompts
- model outputs
- patches
- verification results
- confidence report
- final decision
