# Context Governor Spec

## Responsibility

Build small, phase-specific model packets under hardware and task constraints.

## Inputs

- MissionSlice
- SpecSlice
- EvidencePacket
- DocsPacket
- DesignPacket
- HardwareProfile
- ModelProfile
- Phase

## Outputs

- PhasePacket

## Budget policy

Default middle-mode budgets:

| Phase | Target budget |
|---|---:|
| spec_critic | 800–1500 tokens |
| planner | 1000–2000 |
| code_patch | 2500–6000 |
| review | 1000–2500 |
| bug_analysis | 1500–3000 |
| docs_summary | 1000–2500 |

## Rules

- Include only phase-relevant actions.
- Include exact source snippets only when needed.
- Compress prior attempts aggressively.
- Exclude global tool catalogs.
- Exclude unrelated mission history.
- Include evidence IDs so outputs can cite them.

## Required functions

- `buildPhasePacket(phase, taskId)`
- `allocateBudget(packetInputs)`
- `compressEvidence(evidence, budget)`
- `validatePhasePacket(packet)`
