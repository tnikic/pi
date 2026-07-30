---
name: to-tickets
description: Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the project issue tracker.
disable-model-invocation: true
---

# To Tickets

Break a plan, spec, or conversation into a set of **tickets** — tracer-bullet vertical slices, each declaring the tickets that **block** it.


## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body, comments, and labels.

### 2. Validate the source

Check the source issue's `kind:*` label (scope `kind`) before breaking anything down:

- **`kind:spec`** (scope `kind`, name `spec`) — proceed normally. If the source is missing a `kind:*` label entirely and reads like a spec (has problem statement, user stories, etc.), stamp it with `kind:spec` now and proceed.
- **`kind:ticket`** (scope `kind`, name `ticket`) — stop. Tell the user: "This is already a ticket (`kind:ticket`). Tickets can't be broken into sub-tickets. If this work is too large for one session, convert it to a spec first."
- **`kind:decision`** (scope `kind`, name `decision`) or **`kind:map`** (scope `kind`, name `map`) — stop. Tell the user: "This is a `kind:<x>`, not a spec. It can't be broken into tickets."
- **No `kind:*` and reads like a ticket** (has acceptance criteria, a single buildable unit) — stamp with `kind:ticket` and stop with the same message as above.

### 3. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 4. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests) — vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges** — the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change — rename a column, retype a shared symbol — whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket — green is promised only there.

### 5. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct — does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until the user approves the breakdown.

### 6. Publish the tickets

Publish the approved tickets as **child issues** of the source spec — set `parent` to the spec's issue number when creating each. Create in dependency order (blockers first). After all tickets are created, do a second pass to set each ticket's `blocked_by` edges — the tracker needs issue identifiers before they can reference each other.

Apply the labels `triage:for-agent` (scope `triage`, name `for-agent`) and `kind:ticket` (scope `kind`, name `ticket`) to each ticket. Also stamp the parent's `type:*` label (scope `type`) on every child (a spec's children inherit its type). Unless instructed otherwise, the tickets are agent-grabbable by construction.

Do NOT close or modify any parent issue.

<issue-template>

## What to build

The end-to-end behaviour this ticket makes work, from the user's perspective — not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- A reference to each blocking ticket, or "None — can start immediately".

</issue-template>

Avoid specific file paths or code snippets — they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

Work the frontier one ticket at a time with `/implement`, clearing context between tickets.
