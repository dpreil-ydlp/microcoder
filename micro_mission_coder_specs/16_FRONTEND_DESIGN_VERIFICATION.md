# 16 — Frontend Design Verification

## Goal

Make frontend changes testable and less ugly without relying on vague model taste.

## Design Brain inputs

- `DESIGN.md`
- Tailwind config
- CSS variables
- existing components
- screenshots/baselines
- accessibility rules
- target viewport list

## Required DesignPacket fields

```json
{
  "component_library": "shadcn/ui",
  "tokens": {},
  "component_patterns": [],
  "forbidden_patterns": [],
  "required_states": ["loading", "empty", "error", "success"],
  "viewports": ["390x844", "1440x900"],
  "accessibility_rules": []
}
```

## Verification order

1. Typecheck.
2. Lint.
3. Unit/component tests.
4. Start app.
5. Playwright route load.
6. Console/network error capture.
7. DOM assertions.
8. Screenshot comparison.
9. Optional VLM semantic inspection.

## VLM policy

Only call VLM after screenshots exist.

Good VLM question:

> At 390px width, is the primary CTA visible, readable, and not overlapping the invoice table?

Bad VLM question:

> Does this look good?

## Frontend rejection conditions

- console error
- network error on expected local route
- visible overflow on required viewport
- missing loading/error/empty state
- inaccessible interactive element
- raw colors when tokens exist
- component pattern inconsistent with DesignPacket

## Open Design and chat UI verification additions

Frontend tasks must now classify their surface type before patch generation:

- dashboard
- landing
- form
- chat
- settings
- report
- auth
- other

For `chat` surfaces, include chat-specific checks:

- long message wrapping
- code block rendering
- attachment preview/error state
- streaming/loading state
- retry failed message state
- thread/reaction UI if present
- mobile scroll behavior

For Open Design-assisted tasks, verify that the implemented patch preserves the selected design-system rules and does not blindly paste a prototype into production code.

The verifier must save:

- Playwright screenshots
- DOM assertion logs
- console/network logs
- optional VLM/design-critic result
- selected DesignPacketV2

All artifacts go under `.mission/artifacts/visual/` or `.mission/artifacts/design/`.
