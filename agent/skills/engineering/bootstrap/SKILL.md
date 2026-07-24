---
name: bootstrap
description: Configure this repo for the engineering skills — verify the issue tracker is reachable and set up domain doc layout. Run once before first use of the other engineering skills.
disable-model-invocation: true
---

# Bootstrap

Verify the issue tracker is reachable and confirm the domain doc layout for this repo. Run once before first use of the other engineering skills.

This is a prompt-driven skill, not a deterministic script. Explore, present what you found, and confirm with the user. Domain docs (`docs/CONTEXT.md`, `docs/adr/`) are created lazily by `/domain-modeling` when the first term or decision is resolved — bootstrap only confirms which layout the repo will use.

## Process

### 1. Verify issue tracker capability

Confirm you can interact with the issue tracker for this repo. Try to list open issues — this triggers backend detection and, if needed, auth. If you can't reach the tracker, stop and tell the user they need a way to talk to an issue tracker (e.g. the issue-tracker extension or equivalent).

Do not write any config file for this step — the harness detects the backend and provides the tools automatically.

### 2. Explore

Look at the current repo to understand its starting state. Read whatever exists; don't assume:

- `docs/CONTEXT.md` and `docs/CONTEXT-MAP.md`
- `docs/adr/` and any `src/*/docs/adr/` directories
- Monorepo signals — a `pnpm-workspace.yaml`, a `workspaces` field in `package.json`, or a populated `packages/*` with its own `src/`. Present only in a genuinely large multi-package repo; their absence means single-context, which is almost every repo.

### 3. Present findings and ask

Summarise what's present and what's missing. Then confirm the domain docs layout — one question, one answer.

Lead with the recommended answer so the user can accept it in a word. Give a one-line explainer only when the choice genuinely branches; skip the section entirely when exploration already settled it (when there's no monorepo).

**Domain docs.** Default to **single-context** — one `docs/CONTEXT.md` + `docs/adr/`. This fits almost every repo; write it without asking.

Offer **multi-context** — a root `docs/CONTEXT-MAP.md` pointing to per-context `docs/CONTEXT.md` files — only when exploration found monorepo signals. Then confirm which layout they want.

### 4. Done

Tell the user the setup is complete. Summarise the confirmed layout and mention that `/domain-modeling` will create `docs/CONTEXT.md` and `docs/adr/` lazily when the first term or decision is resolved. Re-running this skill is only necessary if they want to change the layout later.
