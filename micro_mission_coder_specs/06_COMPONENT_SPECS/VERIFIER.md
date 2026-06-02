# Verifier Spec

## Responsibility

Run deterministic checks and collect artifacts.

## Check types

- formatter
- typecheck
- lint
- unit tests
- integration tests
- targeted tests
- full test suite when allowed
- Playwright checks
- screenshot comparison
- console/network error capture

## Required functions

- `runCommand(command, timeout)`
- `runVerificationPlan(task)`
- `selectTargetedTests(files)`
- `collectArtifacts()`
- `summarizeFailures()`

## Rules

- Targeted checks first, broader checks later.
- Commands must have timeouts.
- Dangerous commands require allowlist approval.
- Artifacts must be attached to attempt logs.
