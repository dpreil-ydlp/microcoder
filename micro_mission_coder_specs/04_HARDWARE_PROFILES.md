# 04 — Hardware Profiles

## Purpose

The system must scale behavior down or up depending on hardware. The architecture remains the same; activation changes.

## Profile A — Constrained mode

```yaml
name: constrained_16gb
ram_gb: 16
gpu: optional
ssd_gb: 512
primary_coder: qwen2.5-coder-3b-q4
controller: smollm2-360m-or-gemma-1b
vision: disabled
playwright: disabled_by_default
parallel_model_calls: 1
parallel_test_jobs: 0
context_budget_tokens: 2048-4096
```

### Enabled

- Mission Brain
- Spec Brain
- Repo Brain Lite
- Context Governor
- Patch Harness
- Typecheck/lint/targeted tests

### Disabled/limited

- VLM
- parallel worktrees
- heavy docs reranker
- full Playwright suite
- large local fallback

## Profile B — Middle mode

```yaml
name: middle_32gb
ram_gb: 24-32
gpu: optional_8gb_vram
ssd_gb: 1000
primary_coder: qwen2.5-coder-7b-q4-or-3b-q5
controller: gemma-1b-or-smollm2-1.7b-or-liquid-1.2b
vision: tiny_vlm_cold_optional
playwright: targeted
parallel_model_calls: 1
parallel_test_jobs: 1
context_budget_tokens: 4096-12000
```

### Enabled

- Full Mission Brain
- Spec Brain
- Repo Brain v1/v2
- Docs Brain Lite
- Design Brain text mode
- Patch Harness
- Targeted Playwright
- Model hot/warm/cold states
- Deterministic parallel tasks

## Profile C — Strong middle mode

```yaml
name: strong_middle_48gb
ram_gb: 48
gpu: optional_8_12gb_vram
ssd_gb: 1000-2000
primary_coder: qwen2.5-coder-7b-high-quality-or-larger-quant
controller: separate_tiny_model
vision: tiny_vlm_cold
playwright: enabled
parallel_model_calls: 1
parallel_test_jobs: 1-2
context_budget_tokens: 8000-24000
```

## Profile D — Strong local mode

```yaml
name: strong_local_64gb
ram_gb: 64+
gpu: optional_12_24gb_vram
ssd_gb: 2000+
primary_coder: qwen3-a3b-class-or-qwen3.6-35b-a3b-if-supported
controller: tiny_model_hot
vision: enabled_cold
playwright: enabled
parallel_model_calls: 1-heavy-plus-1-tiny
parallel_test_jobs: 2
context_budget_tokens: 8000-32000-default-longer-on-demand
```

## Hardware Governor behavior

### RAM pressure high

- unload cold models
- reduce context budget
- pause Playwright/VLM
- run only targeted tests

### CPU pressure high

- pause parallel test jobs
- reduce Repo Brain worker count
- disable speculative model warmup

### Battery mode

- single-track execution
- no VLM
- no full browser suite unless explicitly requested

### Thermal pressure high

- unload warm models after each step
- no heavy parallel commands
- prefer clarification/planning phases over codegen

## Main target

Build first for **Profile B: 24–32GB RAM**.

Do not optimize the first version for 64GB-only hardware. The project exists to make modest hardware useful.
