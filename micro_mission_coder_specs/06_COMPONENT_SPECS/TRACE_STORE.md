# Trace Store Spec

## Responsibility

Persist all runtime events for debugging, evaluation, and future training.

## Required logs

- mission state changes
- spec compiler output
- task graph changes
- evidence packets
- phase packets
- model requests/responses
- patches
- command outputs
- artifacts
- confidence scores
- escalation decisions

## Storage recommendation

- SQLite for indexed metadata
- filesystem for large artifacts
- JSONL for attempts/events

## Export formats

- benchmark replay bundle
- training examples
- failure report
- task summary
