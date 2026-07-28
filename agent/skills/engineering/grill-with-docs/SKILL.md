---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.
disable-model-invocation: true
---

Run a `/grilling` session, using the `/domain-modeling` skill.

## During the session

Watch for signals that the discussion is outgrowing a single session:

- **Deferral language** — the user says "let's come back to this," "we'll figure that out later," or explicitly defers a thread.
- **Accumulating threads** — 3 or more unresolved threads pile up without resolution.

When either fires, offer: "This is getting large — want me to create a Wayfinder map to track these threads across sessions?" If the user says yes:

1. Create a **stub map** — a `kind:map` issue with:
   - **Destination**: the feature or decision this session is driving toward.
   - **Notes**: domain, skills to consult, standing preferences surfaced so far.
   - Raw unresolved threads as a fog dump.
2. Tell the user to run `/wayfinder` on the new map — Wayfinder will clean up the body and chart tickets properly.

## Ending the session

When the grilling session concludes, stage all domain-modeling changes (`docs/CONTEXT.md`, `docs/adr/`) and run `/conventional-commits`.
