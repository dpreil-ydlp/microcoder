# Open Design Adapter Spec

## Responsibility

Integrate selected Open Design assets into Micro Mission Coder's Design Brain while preserving small-context execution.

Open Design is not the execution harness. It is an optional design asset/workflow provider used for frontend and artifact-heavy tasks.

## Inputs

- frontend task packet
- compiled spec UI requirements
- existing repo design inventory
- optional Open Design installation path
- optional vendored Open Design skills/systems/templates
- hardware profile

## Outputs

- selected design system reference
- selected skill references
- selected template reference
- compact design-system excerpt
- prototype artifact metadata when generated
- DesignPacketV2 additions

## Required functions

- `detectOpenDesign()`
- `indexOpenDesignAssets()`
- `selectDesignSystem(task, repoDesign, budget)`
- `selectSkills(task, budget)`
- `extractDesignRules(selection, budget)`
- `generatePrototype(task, selection)` optional
- `summarizePrototypeForImplementation(artifact)`
- `buildOpenDesignSection(task, budget)`

## Context policy

Never include full Open Design catalogs in model context. Include only selected excerpts.

```ts
const LIMITS = {
  selectedSystems: 1,
  selectedSkills: 3,
  maxOpenDesignTokens: 1500
};
```

## Hardware policy

- 16GB: reference-only mode.
- 24–32GB: reference-only plus small prototype generation if scheduler approves.
- 48–64GB: prototype and critique modes allowed.

## Failure behavior

If Open Design is missing or incompatible, continue with local Design Brain, existing repo components, and shadcn/ui policy. Do not block non-design coding tasks.

## Security policy

Generated artifacts must be sandbox-previewed and stored under `.mission/artifacts/design/`. Do not execute arbitrary scripts from generated artifacts in the app workspace.
