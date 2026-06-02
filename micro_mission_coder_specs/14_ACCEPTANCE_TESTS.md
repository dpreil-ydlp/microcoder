# 14 — Acceptance Tests

## System acceptance test A — init and mission creation

Input:

```bash
mmc init
mmc spec create "Add a billing dashboard that shows recent invoices"
```

Expected:

- `.mission/` exists.
- DB exists.
- draft spec exists.
- missing details produce clarification questions.

## System acceptance test B — spec gate blocks vague request

Input:

```bash
mmc spec create "make the dashboard better"
mmc mission start
```

Expected:

- implementation does not begin.
- output asks specific questions about desired improvements and acceptance criteria.

## System acceptance test C — Repo Brain freshness gate

Setup:

1. Index repo.
2. Modify target file.
3. Attempt code patch.

Expected:

- system detects stale index.
- code generation blocks.
- Repo Brain refreshes.
- evidence packet is regenerated.

## System acceptance test D — patch scope enforcement

Setup:

Task allows only `src/components/InvoiceTable.tsx`.

Model emits patch touching `src/lib/auth.ts`.

Expected:

- Patch Harness rejects patch.
- attempt logged as failed_scope.
- no file is modified.

## System acceptance test E — verification-gated acceptance

Setup:

Model emits valid patch that fails typecheck.

Expected:

- patch is not accepted.
- failure summary is logged.
- repair loop or escalation decision is created.

## System acceptance test F — mission resume

Setup:

Start mission, complete task T1, stop process, restart.

Expected:

- mission resumes at next unblocked task.
- prior attempt summary is available.
- model does not need chat history.

## System acceptance test G — hardware profile downgrade

Setup:

Set profile to `constrained_16gb`.

Expected:

- VLM disabled.
- parallel worktrees disabled.
- context budget reduced.
- one model call at a time.

## System acceptance test H — frontend targeted verification

Setup:

Frontend task modifies a page component.

Expected:

- DesignPacket generated if DESIGN.md exists.
- Playwright targeted check runs if enabled.
- console errors are captured.
- screenshots stored as artifacts.

## Benchmark acceptance criterion

On a 20-task internal benchmark, the full runtime must beat raw local coder prompting on at least three of these five metrics:

- correct file localization
- patch apply rate
- typecheck/test pass rate
- unrelated edits avoided
- multi-step mission completion rate

## Design integration acceptance tests

- Given a frontend task, the system emits `DesignPacketV2` before code generation.
- Given an existing component pattern, the coder uses the existing component instead of importing a new design system.
- Given a compatible React/Tailwind project with no component pattern, shadcn/ui may be selected.
- Given a chat UI task, chatcn may be selected and chat-specific visual checks are generated.
- Given Open Design installed, the adapter indexes skills/systems/templates but includes only selected excerpts in model context.
- Given 16GB hardware profile, Open Design runs in reference-only mode and VLM is disabled by default.
- Given a generated Open Design prototype, the implementation step summarizes/translates it rather than blindly pasting it into app code.
