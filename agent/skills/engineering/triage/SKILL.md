---
name: triage
description: Move issues through a state machine of triage roles — categorise, verify, grill if needed, and write agent-ready briefs.
disable-model-invocation: true
---

# Triage

Move issues on the project issue tracker through a small state machine of triage roles.

## Reference docs

- [OUT-OF-SCOPE.md](OUT-OF-SCOPE.md) — how the `docs/out-of-scope/` knowledge base works

## Labels

This skill manages labels across three scopes. All scopes are **exclusive** — only one label per scope per issue.

### `triage:*` — triage workflow state

Color: [`secondary`](../../shared/color-palette.md).

- `triage:pending` — maintainer needs to evaluate
- `triage:unanswered` — waiting on reporter for more information
- `triage:for-agent` — fully specified, ready for an AFK agent
- `triage:for-human` — needs human implementation
- `triage:wontfix` — will not be actioned

Every triaged issue carries exactly one `triage:*` label.

### `type:*` — nature of the work

Color: [`primary`](../../shared/color-palette.md).

- `type:bug` — something is broken
- `type:enhancement` — new feature or improvement

Every triaged issue carries exactly one `type:*` label.

### `kind:*` — artifact shape

Color: [`surface`](../../shared/color-palette.md).

- `kind:spec` — a planning document with problem, solution, and user stories
- `kind:ticket` — a single unit of agent-sized work
- `kind:map` — a wayfinder planning map
- `kind:decision` — a question whose resolution is a decision

The triage agent determines `kind:spec` vs `kind:ticket` during evaluation: `kind:spec` when the work needs planning before building, `kind:ticket` when the build is the plan and it fits in one session.

Scoped labels use the notation `scope:name`. When calling tracker tools, always pass them as structured labels — `{scope: "scope", name: "name"}` — not as a flat string with a colon.

---

State transitions: an unlabeled issue normally goes to `triage:pending` first; from there it moves to `triage:unanswered`, `triage:for-agent`, `triage:for-human`, or `triage:wontfix`. `triage:unanswered` returns to `triage:pending` once the reporter replies. The maintainer can override at any time — flag transitions that look unusual and ask before proceeding.

## Invocation

The maintainer invokes `/triage` and describes what they want in natural language. Interpret the request and act. Examples:

- "Show me anything that needs my attention"
- "Let's look at #42"
- "Move #42 to triage:for-agent"
- "What's ready for agents to pick up?"

## Show what needs attention

Query the issue tracker and present three buckets, oldest first:

1. **Unlabeled** — never triaged.
2. **`triage:pending`** — evaluation in progress.
3. **`triage:unanswered` with reporter activity since the last triage notes** — needs re-evaluation.

Show counts and a one-line summary per item. Let the maintainer pick.

## Triage a specific issue

1. **Gather context.** Read the full issue (body, comments, labels, author, dates). Parse any prior triage notes so you don't re-ask resolved questions. Explore the codebase using the project's domain glossary, respecting ADRs in the area. Run two checks against the codebase: (a) **redundancy** — search for an existing implementation of the requested behavior by domain concept (not just the request's wording), and report where you looked. If found, it's an already-implemented `wontfix` (step 5). (b) **prior rejection** — read `docs/out-of-scope/*.md` and surface any that resembles this request.

2. **Recommend.** Tell the maintainer your recommendation with reasoning, plus a brief codebase summary relevant to the request — including whether it's already implemented. Recommend all three label axes:
   - `type:*` — `type:bug` or `type:enhancement`
   - `kind:*` — `kind:spec` (needs planning before building) or `kind:ticket` (the build is the plan, fits one session)
   - `triage:*` — the appropriate state
   
   Wait for direction.

3. **Verify the claim.** Before any grilling, check that the claim holds up. For a bug, reproduce it from the reporter's steps. Report what happened: confirmed (with code path), failed, or insufficient detail (a strong `triage:unanswered` signal). A confirmed verification makes a much stronger implementation brief.

4. **Grill (if needed).** If the request needs fleshing out, run the `/grilling` and `/domain-modeling` skills together — grill it into shape one question at a time, sharpening domain terms and updating `docs/CONTEXT.md`/ADRs inline as decisions land.

5. **Apply the outcome:**
   - `triage:for-agent` — apply the label plus the confirmed `type:*` and `kind:*`, then post an implementation brief comment using the ticket template from [to-tickets](../to-tickets/SKILL.md) with an added `## Out of scope` section.
   - `triage:for-human` — apply the label plus the confirmed `type:*` and `kind:*`. Same structure as an implementation brief, but note why it can't be delegated (judgment calls, external access, design decisions, manual testing).
   - `triage:unanswered` — post triage notes (template below).
   - `triage:wontfix` — close, with the comment depending on *why*:
     - **Already implemented** — the change already exists in the codebase. Point to where it lives; do **not** write to `docs/out-of-scope/` (that KB is for *rejected* requests, not built ones).
     - **Rejected (bug)** — polite explanation, then close.
     - **Rejected (enhancement)** — write to `docs/out-of-scope/`, link to it from a comment, then close ([OUT-OF-SCOPE.md](OUT-OF-SCOPE.md)).
   - `triage:pending` — apply the label. Optional comment if there's partial progress.

## Quick state override

If the maintainer says "move #42 to triage:for-agent" (or any other `triage:*` state), trust them and apply the role directly. Confirm what you're about to do (role changes, comment, close), then act. Skip grilling. If moving to `triage:for-agent` without a grilling session, ask whether they want to write an implementation brief.

## Unanswered template (triage:unanswered)

```markdown
## Triage Notes

**What we've established so far:**

- point 1
- point 2

**What we still need from you (@reporter):**

- question 1
- question 2
```

Capture everything resolved during grilling under "established so far" so the work isn't lost. Questions must be specific and actionable, not "please provide more info".

## Resuming a previous session

If prior triage notes exist on the issue, read them, check whether the reporter has answered any outstanding questions, and present an updated picture before continuing. Don't re-ask resolved questions.
