---
name: wayfinder
description: Plan a huge chunk of work — more than one agent session can hold — as a shared map of decision tickets on your issue tracker, and resolve them one at a time until the way to the destination is clear.
disable-model-invocation: true
---

A loose idea has arrived — too big for one agent session, and wrapped in fog: the way from here to the **destination** isn't visible yet. Wayfinding is about finding that way, not charging at the destination. This skill charts the way as a **shared map** on the repo's issue tracker, then works its **decision tickets** — questions whose resolution is a decision, not slices of a build to execute — one at a time until the route is clear.

The destination varies per effort, and naming it is the first act of charting — it shapes every ticket. It might be a spec to hand off and iterate on, a decision to lock before planning starts, or a change made in place like a data-structure migration. The map is domain-agnostic — engineering work, course content, whatever fits the shape.

This skill assumes your harness can interact with a project issue tracker. If you're unsure, run `/bootstrap` to verify.

## Plan, don't do

Wayfinder is **planning** by default: each ticket resolves a decision, and the map is done when the way is clear — nothing left to decide before someone goes and does the thing. The pull to just do the work is usually the signal you've reached the edge of the map and it's time to hand off. An effort can override this in its **Notes** — carrying execution into the map itself — but absent that, produce decisions, not deliverables.

## Refer by name

Every map and ticket is an issue, so it has a **name** — its title. In everything the human reads — narration, the map's Decisions-so-far — refer to it by that name, never by a bare id, number, or slug. A wall of `#42, #43, #44` is illegible; names read at a glance. The id and URL don't vanish — a name wraps its link — but they ride *inside* the name, never stand in for it.

## The Map

The map is a single issue on this repo's issue tracker, labelled `kind:map` — the canonical artifact. Its tickets are child issues of the map.

The map is an **index**, not a store. It lists the decisions made and points at the tickets that hold their detail; a decision lives in exactly one place — its ticket — so the map never restates it, only gists it and links.

The harness provides the operations that drive the map:

- **Map**: create an issue with label `kind:map` (scope `kind`, name `map`).
- **Child ticket**: create an issue with `parent` set to the map's number, labelled `kind:decision` (scope `kind`, name `decision`) and `wayfinder:<type>` (scope `wayfinder`, name matching the type).
- **Blocking**: set `blocked_by` on the ticket — a set-replacement of the blocker issue numbers.
- **Frontier**: list issues with `parent: <map>`, `state: "open"`, `unblocked: true`, `assignee: "@unassigned"`.
- **Claim**: update the issue with `assignee: "@me"` — the session's first write.
- **Resolve**: comment the answer on the ticket, close the ticket, then append a context pointer to the map's Decisions-so-far.

### The map body

The whole map at low resolution, loaded once per session. Open tickets are **not** listed — they are open child issues, found by query.

```markdown
## Destination

<what reaching the end of this map looks like — the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket.>

## Notes

<domain; skills every session should consult; standing preferences for this effort>

## Decisions so far

<!-- the index — one line per closed ticket: enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [<closed ticket title>](link) — <one-line gist of the answer>

## Not yet specified

<!-- see "Fog of war": in-scope fog you can't ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- see "Out of scope": work ruled beyond the destination; closed, never graduates -->
```

### Tickets

Each ticket is a **child issue** of the map; the tracker's issue id is its identity. Its body is the question, sized to one 100K token agent session:

```markdown
## Question

<the decision or investigation this ticket resolves>
```

Each ticket carries `kind:decision` and a `wayfinder:<type>` label — one of `research`, `prototype`, `grilling` (see [Ticket Types](#ticket-types)).

A session **claims** a ticket by assigning it to the dev driving the map, **first**, before any work, so concurrent sessions skip it. That assignee _is_ the claim: an open, unassigned ticket is unclaimed.

A ticket is **unblocked** when every ticket blocking it is closed; the **frontier** is the open, unblocked, unclaimed children — the edge of the known.

The answer isn't part of the body — it's recorded on resolution (see [Work through the map](#work-through-the-map)). Assets created while resolving a ticket are linked from the issue, not pasted in.

## Ticket Types

Every ticket is either **HITL** — human in the loop, worked *with* a human who speaks for themselves — or **AFK**, driven by the agent alone. A HITL ticket only resolves through that live exchange; the agent never stands in for the human's side of it (a grilling agent that answers its own questions has broken this).

- **Research** (AFK): Reading documentation, third-party APIs, or local resources like knowledge bases to surface a fact a decision waits on. Resolved by the `subagent` tool with `agent: "worker"`. Use when knowledge outside the current working directory is required.
- **Prototype** (HITL): Raise the fidelity of the discussion by making a cheap, rough, concrete artifact to react to — an outline, a rough take, a stub, or UI/logic code via the /prototype skill. Links the prototype as an asset. Use when "how should it look" or "how should it behave" is the key question.
- **Grilling** (HITL): Conversation via the /grilling and /domain-modeling skills, one question at a time. The default case.
When a decision is blocked by work that must be *executed* before it can be resolved — signing up for a service so its API can be judged, provisioning access, moving data so its shape can be seen — that work is a regular `kind:ticket` (scope `kind`, name `ticket`), not a child of the map. Create it on the tracker, then set the decision's `blocked_by` to reference it. The map holds only decisions; execution lives outside.

## Fog of war

The map is _deliberately_ incomplete: don't chart what you can't yet see. Beyond the live tickets lies the **fog of war** — the dim view of decisions and investigations you can tell are coming but can't yet pin down, because they hang on questions still open. Resolving a ticket clears the fog ahead of it, graduating whatever's now specifiable into fresh tickets — one at a time, until the way to the destination is clear and no tickets remain.

The map's **Not yet specified** section is where that dim view is written down: the suspected question, the area to revisit later. It's the undiscovered frontier _toward_ the destination — everything here is in scope, just not sharp enough to ticket. Write as loosely or as fully as the view allows; it doubles as a signpost for collaborators reading where the effort is headed.

**Fog or ticket?** The test is whether you can state the question precisely now — _not_ whether you can answer it now.

- **Ticket when** the question is already sharp — even if it's blocked and you can't act on it yet.
- **Not yet specified when** you can't yet phrase it that sharply. Don't pre-slice the fog into ticket-sized pieces: it's coarser than a ticket, and one patch may graduate into several tickets, or none, once the frontier reaches it.

**Not yet specified** excludes what's already decided (Decisions so far), what's already a live ticket, and what's out of scope (the next section).

## Out of scope

Fog only ever gathers _toward_ the destination. The destination fixes the scope, so work beyond it is **out of scope** — it isn't fog, and it doesn't belong in **Not yet specified**. It gets its own **Out of scope** section on the map: work you've consciously ruled out of _this_ effort. Scope, not sharpness, lands it here.

Out-of-scope work never graduates — the frontier stops at the destination — so it returns only if the destination is redrawn, and then as a fresh effort, not a resumption.

Ruling something out of scope is a scoping act, not a step on the route. When a ticket that already exists turns out to sit past the destination — mis-scoped in while charting, or exposed by a resolution — **close it** (a closed ticket is unambiguously off the frontier) and leave one line in the **Out of scope** section: the gist plus why it's out of scope, linking the closed ticket. It stays out of **Decisions so far**, which records the route actually walked — a scope boundary isn't a step on it.

## Invocation

Two modes. Either way, **never resolve more than one ticket per session** — with the exception of research tickets.

**Before either mode:** verify you are on the default branch (`main`). Wayfinder updates `docs/CONTEXT.md` and creates ADRs — project-level artifacts that belong on the default branch. If on any other branch, stop and tell the user to switch to `main`.

### Chart the map

User invokes with a loose idea.

1. **Name the destination.** Run a `/grilling` and `/domain-modeling` session to pin down what this map is finding its way to — the spec, decision, or change. The destination fixes the scope, so it's settled first.
2. **Map the frontier.** Grill again, **breadth-first** this time: fan out across the whole space rather than deep on any one thread, surfacing the open decisions and the first steps takeable now. **If this surfaces no fog** — the way to the destination is already clear, the whole journey small enough for one session — you don't need a map. Stop and ask the user how they'd like to proceed.
3. **Create the map** (label `kind:map`): Destination and Notes filled in, Decisions-so-far empty, the fog sketched into **Not yet specified**.
4. **Create the tickets you can specify now** as child issues of the map, each labelled `kind:decision` and the appropriate `wayfinder:<type>` — then wire blocking edges in a **second pass** (issues need ids before they can reference each other). Wiring sorts them into the frontier and the blocked; everything you can't yet specify stays in the fog — the **Not yet specified** section.
5. **Fire the research subagents.** For each `research` ticket you just created, spin up a `subagent` with `agent: "worker"` to resolve it in parallel, writing findings to a local `research/<name>` branch and capturing them in the resolution comment. The subagent deletes its branch after posting findings — branches stay local, never pushed.
6. Stop — charting is one session's work; it hand-resolves nothing.

### Work through the map

User invokes with a map (URL or number). A ticket is **optional** — without one, you pick the next decision, not the user.

1. **Detect stub maps.** Load the map. If it has a Destination and Notes but no structured **Not yet specified** or **Out of scope** sections — just a raw dump of unresolved threads — this is a stub from a `/grill-with-docs` session. Clean up the body first: categorize every raw item into **Not yet specified** or **Out of scope**, cut the raw dump. If already structured, skip.
2. Choose the ticket. If the user named one, use it. Otherwise take the first frontier ticket in order. **Claim it**: assign it to yourself before any work.
3. Resolve it — **zoom as needed**: fetch the full body of any related or closed ticket on demand; invoke the skills the `## Notes` block names. If in doubt, use `/grilling` and `/domain-modeling`. **Update `docs/CONTEXT.md`** as domain terms crystallize, following the [domain-modeling skill](../domain-modeling/SKILL.md).
4. Record the resolution: post the answer as a **resolution comment**, **close** the issue, and **append a context pointer** to the map's Decisions-so-far. If this was a **research** ticket, delete the local `research/<name>` branch — the comment is the canonical record.
5. Add newly-surfaced tickets (create-then-wire); graduate any fog the answer has made specifiable, clearing each graduated patch from **Not yet specified** so it lives only as its new ticket. If the answer reveals a ticket — this one or another — sits beyond the destination, **rule it out of scope** rather than resolving it on the route. If the decision invalidates other parts of the map, update or delete those tickets.
6. **Check the frontier.** Query open child tickets. If none remain, proceed to **Closing the map**. Otherwise stop — the next session picks up the next frontier ticket.

The user may run unblocked tickets in parallel, so expect other sessions to be editing the tracker concurrently.

### Closing the map

When the frontier is empty, the route is clear. Before closing, do these in order:

1. **Propose follow-up maps.** Present residual **Not yet specified** items and **Out of scope** items to the user. For each, ask whether to create a new Wayfinder map. The agent may suggest grouping related items into a single map — propose groupings and let the user approve. For items the user wants to map:
   - Create a new `kind:map` issue with Destination and Notes filled in, and the items as raw fog.
   - The new map's body includes a **Parent** reference linking back to this map.
   - In this map's **Not yet specified** or **Out of scope** section, replace the text description with a link to the new map.
   *Completion criterion: every residual-fog and out-of-scope item either has a follow-up map or is noted as deliberately left unresolved.*

2. **Create ADRs.** Evaluate every closed decision ticket against the three ADR tests in [`domain-modeling/ADR-FORMAT.md`](../domain-modeling/ADR-FORMAT.md). For each that passes all three, create an ADR in `docs/adr/` following that same format. *Completion criterion: every closed decision evaluated against the three tests; an ADR created for each that qualifies.*

3. **Write the closing summary.** Use the format in [`CLOSING-SUMMARY.md`](CLOSING-SUMMARY.md). Post it as a comment on the map, then append it to the map body below **Decisions so far** as **Route found**. *Completion criterion: closing summary posted as comment and appended to map body.*

4. **Commit file changes.** Scan the closing summary and key decisions for domain terms. Check `docs/CONTEXT.md` for any not yet captured; update if found. Stage all changes (`docs/CONTEXT.md`, `docs/adr/`). Run `/conventional-commits` — ADRs as separate commits, glossary changes batched. *Completion criterion: all file changes committed; user approved each via conventional-commits review.*

5. **Close the map.** Present the closing summary and ask: "The route is clear. Close the map?" Close on confirmation. *Completion criterion: user confirmed; map issue closed.*
