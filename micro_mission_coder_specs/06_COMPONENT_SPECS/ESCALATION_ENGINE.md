# Escalation Engine Spec

## Responsibility

Decide when to ask the user, call a larger local model, or call a remote expert.

## Escalation triggers

- repeated failure with unchanged error
- missing spec decision
- high-risk domain
- reviewer veto
- no relevant evidence found
- low confidence after repair loop
- task exceeds hardware profile

## Escalation types

1. Ask user a specific question.
2. Ask Repo Brain for more evidence.
3. Use larger local model if available.
4. Use remote expert if configured.
5. Stop and report blocker.

## Sparse expert rule

Expert fallback is advisory by default. The local harness still executes and verifies the patch.
