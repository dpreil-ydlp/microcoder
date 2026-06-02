# Patch Harness Spec

## Responsibility

Apply, test, accept, and revert model-generated patches safely.

## Required functions

- `createWorktree(taskId)`
- `parseUnifiedDiff(diff)`
- `validatePatchScope(patch, allowedFiles)`
- `applyPatch(patch)`
- `revertPatch(attemptId)`
- `formatChangedFiles()`
- `collectDiff()`
- `commitCheckpoint()`

## Patch rules

- Patches must be unified diffs or structured edit operations.
- Patches may touch only allowed files.
- New file creation must be explicitly allowed by task plan.
- Deletes require elevated risk flag.
- Large rewrites require reviewer phase.

## Rejection conditions

- patch does not apply
- touches forbidden files
- modifies unrelated files
- deletes code without task justification
- changes lockfile without dependency task
- verification fails and no repair loop remains
