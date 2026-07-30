---
name: domain-modeling
description: Build and sharpen a project's domain model. Use when the user wants to pin down domain terminology or a ubiquitous language, record an architectural decision, or when another skill needs to maintain the domain model.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline — challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* `CONTEXT.md` for vocabulary is not this skill — that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## File structure

Most repos have a single context:

```
/
├── docs/
│   ├── CONTEXT.md
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `docs/CONTEXT-MAP.md` exists, the repo has multiple contexts. The map points to where each one lives:

```
/
├── docs/
│   ├── CONTEXT-MAP.md
│   └── adr/                          ← system-wide decisions
├── src/
│   ├── ordering/
│   │   └── docs/
│   │       ├── CONTEXT.md
│   │       └── adr/                  ← context-specific decisions
│   └── billing/
│       └── docs/
│           ├── CONTEXT.md
│           └── adr/
```

Create files lazily — only when you have something to write. If no `docs/CONTEXT.md` exists, create one when the first term is resolved. If no `docs/adr/` exists, create it when the first ADR is needed.

**First run in a repo:** if neither `docs/CONTEXT.md` nor `docs/CONTEXT-MAP.md` exists, check for monorepo signals — a `pnpm-workspace.yaml`, a `workspaces` field in `package.json`, or a populated `packages/*` with its own `src/`. Default to single-context (one `docs/CONTEXT.md` + `docs/adr/`). Offer multi-context only when monorepo signals are present.

When you're exploring the codebase for another skill (not actively domain-modeling) and these files don't exist yet, **proceed silently**. Don't flag their absence or suggest creating them upfront — that's domain-modeling's job when the time is right.

## During the session

### Use the glossary's vocabulary

In your own output — issue titles, refactor proposals, hypotheses, test names, any artifact that names a domain concept — use the term exactly as defined in `docs/CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `docs/CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Flag ADR conflicts

When your output — a spec, a ticket, a refactor proposal, a hypothesis, any artifact — contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update CONTEXT.md inline

When a term is resolved, update `docs/CONTEXT.md` right there. Don't batch these up — capture them as they happen. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

`docs/CONTEXT.md` should be totally devoid of implementation details. Do not treat `docs/CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).
