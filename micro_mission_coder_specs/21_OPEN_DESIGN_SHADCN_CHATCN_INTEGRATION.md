# 21 — Open Design, shadcn/ui, and chatcn Integration Addendum

## Purpose

This addendum restores and hardens the frontend design component. The system must not regress into generic AI UI. Frontend work should be driven by a dedicated Design Brain that can consume Open Design assets, shadcn/ui component patterns, chatcn chat-interface components, local app conventions, visual checks, and accessibility constraints.

## External projects to evaluate and optionally integrate

### Open Design

Repository: https://github.com/nexu-io/open-design

Open Design is a local-first, open-source Claude Design alternative. It exposes a design workflow built around Skills, Design Systems, templates, sandboxed previews, exportable artifacts, and existing coding-agent CLIs. It should be treated as a design workflow and asset source, not as the core coding harness.

### shadcn/ui

Repository: https://github.com/shadcn-ui/ui
Site: https://ui.shadcn.com/

shadcn/ui should be the default React/Tailwind component foundation when the target repo already uses React/Next/Tailwind or has no competing design system. It is open-source/open-code and intended to be customized into an owned component library.

### chatcn

Repository: https://github.com/leonickson1/chatcn
Site: https://chatcn-iota.vercel.app/

chatcn should be treated as an optional chat-surface component library for agent/chat UI work. It is built on shadcn/ui and Tailwind. Use it only when the product surface includes chat, threads, attachments, reactions, or agent conversation UI.

## Non-negotiable design rule

Do not pipe Open Design, shadcn/ui, or chatcn catalogs directly into small model context.

The Design Brain must compile a tiny `DesignPacket` for each task. The packet may reference selected skills, selected components, selected design-system rules, and selected screenshots. It must not dump entire design libraries.

## OpenDesignAdapter responsibilities

Implement an optional `OpenDesignAdapter` service under `src/core/design-brain/adapters/open-design/`.

The adapter must:

1. Detect whether Open Design is installed or vendored.
2. Index available Open Design Skills, Design Systems, templates, and example artifacts.
3. Select at most one primary design system per task unless the user explicitly asks for alternatives.
4. Select at most three skills per task.
5. Extract compact rules from `DESIGN.md`/Skill files into the local DesignPacket.
6. Never expose the full Open Design tool catalog to the coding model.
7. Keep all Open Design use outside the hot coding path unless the task is explicitly frontend/design/artifact work.
8. Cache generated design briefs and selected rules in `.mission/design/`.
9. Export artifacts into the mission artifact store, not arbitrary project locations.
10. Mark all generated design artifacts as draft until verified by the frontend verifier.

## Design Brain upgraded data sources

The Design Brain should consider these sources in priority order:

1. Existing application design system and components.
2. Existing `DESIGN.md`, tokens, Tailwind config, CSS variables, theme files.
3. Local component inventory from Repo Brain.
4. shadcn/ui base patterns, only if compatible with the app stack.
5. chatcn patterns, only for chat surfaces.
6. Selected Open Design design system/skill/template.
7. User-provided screenshots, wireframes, or brand references.

Existing repo conventions beat Open Design defaults. Do not introduce a new visual language into an established product unless the spec explicitly calls for a redesign.

## Design workflow

For frontend/design tasks, use this pipeline:

```text
User prompt/spec
  ↓
Spec Brain extracts UI intent and missing design constraints
  ↓
Design Brain detects stack and existing design system
  ↓
OpenDesignAdapter optionally selects design system/skills/templates
  ↓
Design Brain builds compact DesignPacket
  ↓
Coder generates patch using allowed components/tokens only
  ↓
Harness starts app/story route
  ↓
Playwright checks DOM, console, network, responsive viewports
  ↓
Screenshot artifacts saved
  ↓
Optional VLM/design critic answers narrow visual questions
  ↓
Confidence Engine accepts/retries/escalates
```

## DesignPacket v2 required fields

```json
{
  "packet_version": "design-packet-v2",
  "task_id": "T-frontend-001",
  "ui_surface": "dashboard | landing | form | chat | settings | report | auth | other",
  "primary_design_source": "existing_repo | shadcn_ui | chatcn | open_design | user_reference",
  "component_library": "existing | shadcn/ui | chatcn | custom",
  "open_design": {
    "enabled": false,
    "selected_system": null,
    "selected_skills": [],
    "selected_template": null,
    "brief_id": null
  },
  "tokens": {
    "colors": {},
    "typography": {},
    "spacing": {},
    "radius": {},
    "shadows": {}
  },
  "allowed_components": [],
  "forbidden_components": [],
  "required_states": ["loading", "empty", "error", "success"],
  "viewports": ["390x844", "768x1024", "1440x900"],
  "accessibility_rules": [],
  "interaction_rules": [],
  "visual_references": [],
  "anti_patterns": [],
  "verification_questions": []
}
```

## Chat UI policy

When the requested surface includes chat, agent messages, conversation history, file attachments, threads, code blocks, reactions, or streaming responses:

1. Use existing app chat components first.
2. If none exist and the stack is React/Tailwind/shadcn-compatible, allow chatcn as a candidate source.
3. Require message states: empty, loading/streaming, sent, failed, retrying, attachment uploading, code block rendering.
4. Require keyboard navigation and screen-reader labels for message actions.
5. Require overflow/scroll behavior checks on mobile and desktop.
6. Require long-message and code-block visual checks.

## Open Design usage modes

### Mode 1 — Reference only

Use Open Design as a source of design-system rules, templates, and checklists. No external design generation run.

Use when:

- hardware is constrained;
- the target app already has a design system;
- the task is a small UI change.

### Mode 2 — Prototype generation

Use Open Design to generate a standalone prototype or design artifact, then translate selected pieces into the target repo.

Use when:

- the user asks for a new screen, landing page, deck, dashboard, or prototype;
- no existing product design system exists;
- the task benefits from multiple visual directions.

### Mode 3 — Design critique

Use Open Design-style critique/checklists to score an existing patch or screenshot.

Use when:

- frontend verifier finds no hard failure, but design quality is questionable;
- user asks for polish;
- design confidence is low.

## Context budget rules

For 16GB hardware:

- Open Design: reference-only mode.
- Max selected skills: 1.
- Max design-system excerpt: 600 tokens.
- No VLM by default.

For 24–32GB hardware:

- Open Design: reference-only or prototype mode for small screens.
- Max selected skills: 2.
- Max design-system excerpt: 900 tokens.
- Tiny VLM optional and cold-loaded.

For 48–64GB hardware:

- Open Design: full prototype/critique mode allowed.
- Max selected skills: 3.
- Max design-system excerpt: 1,500 tokens.
- VLM and Playwright visual loops allowed by scheduler.

## Acceptance criteria for this integration

- `DesignPacketV2` is generated for every frontend task.
- `OpenDesignAdapter` never exposes full Open Design catalogs to model context.
- shadcn/ui is used only when stack-compatible and not in conflict with existing app conventions.
- chatcn is used only for chat surfaces or agent-conversation UI.
- Every frontend patch has DOM, console, network, and viewport checks.
- Visual artifacts are written to `.mission/artifacts/visual/`.
- The Confidence Engine includes a design confidence subscore.

## Implementation tickets

1. Add `OpenDesignAdapter` interface.
2. Add Open Design asset indexer.
3. Add `DesignPacketV2` schema.
4. Add shadcn/ui component inventory importer.
5. Add chatcn component-source policy.
6. Add design brief preprocessor.
7. Add design-system selector.
8. Add frontend verification questions generator.
9. Add design confidence scoring.
10. Add artifact storage for screenshots/prototypes.

## Do not do

- Do not make Open Design the core harness.
- Do not use MCP in the hot path for Open Design.
- Do not dump Open Design Skills/Systems catalogs into small model context.
- Do not use shadcn/ui as an excuse to ignore existing app components.
- Do not treat VLM aesthetic judgment as truth.
- Do not let generated prototypes bypass patch verification.
