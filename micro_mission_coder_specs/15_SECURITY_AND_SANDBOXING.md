# 15 — Security and Sandboxing

## Security posture

The system runs local commands and edits code. Treat model output as untrusted.

## Command policy

Default allowed commands:

- typecheck
- lint
- test
- format
- Playwright test if configured

Default blocked commands:

- network install commands unless approved
- destructive filesystem commands
- credential access
- deployment commands
- database migration against non-local DB
- git push
- secret scanning bypasses

## Secrets

- Never include `.env` values in model context.
- Redact secrets from command output.
- Detect common secret patterns in patches.

## Patch safety

- Reject patches touching secrets/config unless task explicitly allows it.
- Reject patches that disable tests without explicit approval.
- Require elevated risk for auth/payment/schema changes.

## Worktree safety

- Use isolated git worktrees for implementation tasks.
- Never modify user branch directly unless configured.
- Always create checkpoint before patch application.

## Remote escalation

If remote model fallback is enabled:

- redact secrets
- send only the PhasePacket, not full repo
- require user opt-in for sensitive files
- log every remote call
