# Confidence Engine Spec

## Responsibility

Compute accept/retry/escalate decisions from signals.

## Signals

Positive:

- patch applied cleanly
- targeted tests pass
- typecheck passes
- lint passes
- screenshot comparison passes
- touched expected files only
- official docs evidence used when needed

Negative:

- no reproduction
- same failure after retry
- stale evidence
- high-risk file touched
- security/payment/schema area touched
- reviewer disagreement
- visual failure

## Example scoring

```text
confidence =
  test_score
+ typecheck_score
+ lint_score
+ localization_score
+ docs_grounding_score
+ patch_scope_score
+ visual_score
- risk_score
- loop_score
- stale_context_score
```

## Decision bands

- 80–100: accept
- 60–79: accept with caveat or run broader tests
- 40–59: ask user, retrieve more evidence, or retry
- <40: escalate or block

## Rule

Do not ask the model if it is confident. The model may explain the score; it does not set it.
