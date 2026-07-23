---
name: bootstrap
description: Configure this repo for the engineering skills — verify the issue tracker is reachable, set up triage label vocabulary, and domain doc layout. Run once before first use of the other engineering skills.
disable-model-invocation: true
---

# Bootstrap

Scaffold the per-repo configuration that the engineering skills assume:

- **Issue tracker** — verify the harness can interact with this repo's issue tracker
- **Triage labels** — the strings used for the five canonical triage roles
- **Domain docs** — where `docs/CONTEXT.md` and ADRs live, and the consumer rules for reading them

This is a prompt-driven skill, not a deterministic script. Explore, present what you found, confirm with the user, then write.

## Process

### 1. Verify issue tracker capability

Confirm you can interact with the issue tracker for this repo. Try to list open issues — this triggers backend detection and, if needed, auth. If you can't reach the tracker, stop and tell the user they need a way to talk to an issue tracker (e.g. the issue-tracker extension or equivalent).

Do not write any config file for this step — the harness detects the backend and provides the tools automatically.

### 2. Explore

Look at the current repo to understand its starting state. Read whatever exists; don't assume:

- `docs/CONTEXT.md` and `docs/CONTEXT-MAP.md`
- `docs/adr/` and any `src/*/docs/adr/` directories
- `docs/agents/` — does this skill's prior output already exist?
- Is the `triage` skill installed? (a `triage` skill folder alongside this one, or `triage` in your available skills.) This decides whether Section A runs at all.
- Monorepo signals — a `pnpm-workspace.yaml`, a `workspaces` field in `package.json`, or a populated `packages/*` with its own `src/`. Present only in a genuinely large multi-package repo; their absence means single-context, which is almost every repo.

### 3. Present findings and ask

Summarise what's present and what's missing. Then take the sections in order — one section, one answer, then the next.

Lead each section with the recommended answer so the user can accept it in a word. Give a one-line explainer only when the choice genuinely branches; skip the section entirely when exploration already settled it (Section A when `triage` isn't installed, Section B when there's no monorepo).

**Section A — Triage label vocabulary.** Skip this section entirely if the `triage` skill isn't installed (exploration told you) — an uninstalled skill needs no labels.

If it is installed, ask exactly one question:

> Do you want to keep the default triage labels? (recommended: **yes**)

The defaults are the five canonical roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. On **yes**, write them as-is. Only if the user says no — usually because their tracker already uses other names (e.g. `bug:triage` for `needs-triage`) — collect the overrides so `triage` applies existing labels instead of creating duplicates.

**Section B — Domain docs.** Default to **single-context** — one `docs/CONTEXT.md` + `docs/adr/`. This fits almost every repo; write it without asking.

Offer **multi-context** — a root `docs/CONTEXT-MAP.md` pointing to per-context `docs/CONTEXT.md` files — only when exploration found monorepo signals. Then confirm which layout they want.

### 4. Confirm and edit

Show the user a draft of `docs/agents/triage-labels.md` and `docs/agents/domain.md` (the first only when `triage` is installed). Let them edit before writing.

Write the docs files using the seed templates in this skill folder as a starting point:

- [triage-labels.md](./triage-labels.md) — label mapping (only if `triage` is installed)
- [domain.md](./domain.md) — domain doc consumer rules + layout

### 5. Done

Tell the user the setup is complete and which engineering skills will now read from these files. Mention they can edit `docs/agents/*.md` directly later — re-running this skill is only necessary if they want to restart from scratch.
