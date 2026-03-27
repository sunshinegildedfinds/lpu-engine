<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Repo Architecture Contract

## 3-Layer Product Model

This repo follows a strict 3-layer model.

- Layer 1: produce normalized item classification and structured attributes from uploaded items.
- Layer 2: validate and correct Layer 1 structured output.
- Layer 3: execute marketplace UI actions using reusable field definitions and control adapters.

## Layer Ownership

- Layer 1 owns item understanding and primary structure creation.
- Layer 2 owns correctness and normalization of that structure.
- Layer 3 owns safe UI transcription of validated data into Vendoo.

## Universal Layer 3 Action Engine Contract

### Layer 3 Responsibilities

- Read structured payload output from Layer 1/2.
- Resolve field contracts for the target marketplace.
- Select the correct control adapter from control metadata.
- Apply value policies only when field contract allows it.
- Perform safe UI actions with explicit collision prevention.
- Report outcomes as `filled`, `needs_review`, or `skipped_for_safety` with diagnostics.

### Layer 3 Non-Responsibilities

- Do not decide what the item is.
- Do not reclassify items.
- Do not invent attributes not supplied by Layer 1/2.
- Do not replace validated category/attribute logic with one-off UI hacks.
- Do not become a pile of item-specific flows.

### Universal Control Patterns Proven So Far

- Text input adapter behavior.
- Textarea adapter behavior.
- Staged modal picker adapter behavior.
- React Select adapter behavior.

These are proof slices, not the final scope boundary.

### Universal Architecture Principles

- Field definition says what to fill.
- Adapter says how to interact with control type.
- Value policy says whether/how safe value adaptation is allowed.
- Action model records status and diagnostics.

## Separation Rules (Must Stay Explicit)

Keep these concerns separate in code:

- Field contract.
- Control adapter.
- Value policy.
- Action/result model.

Do not bury all four inside one function.

## Proven Slice Rule

Current eBay clothing + Vendoo flow is implementation evidence.

- Allowed: use this slice to prove adapter behavior and safety patterns.
- Not allowed: treat this slice as the long-term product direction.

## Codex Working Rules For This Repo

- Preserve the 3-layer architecture on every change.
- Do not move Layer 1/2 reasoning into Layer 3.
- Do not solve issues by hardcoding one item type as design.
- When debugging one field/control, extract reusable adapter behavior.
- Keep current working flow intact while generalizing structure.
- Prefer safety over aggressive guessing.
- Preserve explicit diagnostics and last-run reporting.
- Keep files small, readable, and beginner-inspectable.

## Repo Map (Current)

App-side orchestration and UI:

- `app/page.tsx`
- `components/ebay/*`
- `components/vendoo/*`

App-side generation/validation/payload mapping:

- `lib/ebay/*`
- `lib/validator/*`
- `lib/vendoo/*`
- `lib/sendVendooPayloadToExtension.ts`

Extension-side Layer 3 engine:

- `listing-writer-app/extension/vendoo-fill/content-vendoo.js` (runtime orchestration + panel + safe execution)
- `listing-writer-app/extension/vendoo-fill/vendooSelectors.js` (field/control metadata)
- `listing-writer-app/extension/vendoo-fill/vendooFieldDefinitions.js` (field definitions / contracts)
- `listing-writer-app/extension/vendoo-fill/vendooAdapters.js` (control adapters + value adaptation hooks)
- `listing-writer-app/extension/vendoo-fill/vendooActionModel.js` (action/result model)
- `listing-writer-app/extension/vendoo-fill/content-app.js` (app page bridge)
- `listing-writer-app/extension/vendoo-fill/background.js` (payload storage/bridge)
- `listing-writer-app/extension/vendoo-fill/manifest.json` (content script wiring)

## Architectural Alignment Checklist

A change is aligned only if all are true:

- Layer 1/2 remain source of truth for item/category/attributes.
- Layer 3 only interprets UI controls and executes safe actions.
- Field definition, adapter logic, and value policy remain separate.
- Action outcomes remain explicit and diagnosable.
- Existing working flow remains intact.

## Manual Verification After Layer 3 Changes

Run this minimal manual flow:

- From app: generate draft, validate, select final title, send payload.
- In Vendoo panel: run `Fill eBay`.
- Confirm no regression for title, description, category, brand, and color.
- Confirm size behavior follows field policy + exact option matching rules.
- Confirm last-run output still reports `Filled`, `Needs review`, `Skipped for safety` with useful diagnostics.

## Naming Direction

Use names that reflect universal Layer 3 intent.

- Prefer: `FieldDefinitions`, `Adapters`, `ActionModel`, `ValuePolicy`.
- Avoid naming that suggests one-off item/category-only architecture.
