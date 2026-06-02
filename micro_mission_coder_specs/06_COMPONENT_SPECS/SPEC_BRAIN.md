# Spec Brain Spec

## Responsibility

Turn a rough goal or spec sheet into an executable, verifiable task graph.

## Inputs

- natural language prompt
- Markdown spec
- JSON spec
- existing `.mission/spec.json`

## Outputs

- compiled spec
- clarification questions
- task graph
- verification plan
- risk flags

## Hard gates

Implementation must block if:

- no measurable acceptance criteria exist
- security/payment/PII behavior is ambiguous
- schema migration lacks rollback plan
- UI task lacks expected states
- target repo area cannot be localized

## Clarification question rules

Ask precise questions. Do not ask generic “provide more details” questions.

Good:

> Should invoices be loaded from Stripe directly or from the local database cache?

Bad:

> Can you clarify the billing dashboard?

## Required functions

- `compileSpec(input)`
- `detectAmbiguity(spec)`
- `generateClarifyingQuestions(spec)`
- `generateTaskGraph(spec, repoHints)`
- `generateVerificationPlan(spec)`

## Task graph output

Each task must include:

- ID
- title
- requirement IDs
- acceptance criteria IDs
- dependencies
- allowed file hints if known
- verification commands if known
- risk flags
