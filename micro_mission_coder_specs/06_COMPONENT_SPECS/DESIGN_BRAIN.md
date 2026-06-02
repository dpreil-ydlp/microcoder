# Design Brain Spec

## Responsibility

Provide frontend design constraints, component inventory, visual rules, and UI acceptance criteria.

## Inputs

- DESIGN.md
- existing components
- CSS/tailwind config
- design tokens
- screenshots/baselines
- accessibility rules

## Outputs

- DesignPacket

## Required functions

- `loadDesignSystem()`
- `extractTokens()`
- `inventoryComponents()`
- `detectFrontendTask(task)`
- `buildDesignPacket(task, budget)`
- `generateUiStateChecklist(task)`

## Required UI states for frontend tasks

- loading
- empty
- error
- success
- mobile
- desktop
- keyboard navigation when interactive

## Rules

- No random raw colors if tokens exist.
- No new component library unless explicitly allowed.
- Prefer existing component patterns.
- Require responsive checks for layout changes.

## Open Design / shadcn/ui / chatcn upgrade

Design Brain must support an optional Open Design integration. Open Design is a local-first design workflow and asset source; it is not the core coding harness.

Design Brain must also know when to use:

- existing repo components first;
- shadcn/ui as the default React/Tailwind component foundation when compatible;
- chatcn only for chat or agent-conversation surfaces;
- selected Open Design skills/systems/templates only when a design task benefits from them.

### New required functions

- `detectDesignSource(task, repo)`
- `selectComponentLibrary(task, repoDesign)`
- `buildDesignPacketV2(task, budget)`
- `selectOpenDesignAssets(task, budget)`
- `selectChatComponents(task)`
- `generateDesignVerificationQuestions(task, screenshots)`

### New rule

Never dump design catalogs into model context. Compile selected rules into `DesignPacketV2`.

See `21_OPEN_DESIGN_SHADCN_CHATCN_INTEGRATION.md` and `07_SCHEMAS/design_packet.v2.schema.json`.
