---
name: update-docs
description: Update human-facing project documentation from changes since the last README sync. Human-callable only.
disable-model-invocation: true
---

# Update Docs

Sync the project's human-facing documentation — README, wiki references, and documentation index — with everything that has changed since the last time the README was touched.

This skill only updates files meant for humans. Agent-facing files under `docs/` (ADRs, CONTEXT.md, style guides) are maintained by other skills and are consumed here as source material, not edited.

## 1. Discover what changed

Find the last commit that touched `README.md`:

```bash
git log --oneline -1 -- README.md
```

If no such commit exists (new project, no README yet), treat the entire history as new. If the file does not exist, note that it will be created.

Collect everything that happened since that commit:

- **Commits**: `git log --oneline <last-readme-commit>..HEAD`
- **Closed issues**: query the issue tracker for issues closed since the date of that commit. Include their titles and any `kind:spec` or `kind:ticket` labels.
- **Diffs**: if a commit message is vague, inspect its diff for context. Do not read every diff up front — only drill into commits whose message does not make the change clear.

**Completion:** Every commit and closed issue since the last README touch has been collected and understood well enough to describe to a human.

## 2. Analyze against the current README

Read the current `README.md` (if it exists). For each mandatory section defined in the standards, note whether it is present and whether it still reflects the current state of the project.

Categorize every change from step 1 into one of:

- **New capability** — a feature, tool, or behaviour the README should mention
- **Changed behaviour** — something that worked one way and now works differently
- **Removed capability** — something the README describes that no longer exists
- **Structural change** — new directories, renamed modules, architectural shifts
- **Not README-relevant** — internal refactors, typo fixes, dependency bumps that do not change what the project does

Also scan the repo for badge-worthy signals: CI config, language version files, LICENSE, platform constraints, coverage config, git tags. Apply the heuristics in the standards.

**Completion:** Every change is categorized. Every badge signal has been checked. A clear gap list exists: what the README needs to gain, change, or remove.

## 3. Decide: README-only or wiki-warranted

Draft the README updates in your head. The wiki threshold is crossed when any of these are true:

- The README draft would need **3 or more major sections with their own subsections** (not counting the 8 mandatory sections, which always exist)
- There are **multiple installation paths** that vary by platform, harness, or environment — each needing its own explanation
- There is a **configuration surface with 5 or more distinct options** that each need explaining
- The **architecture has 3 or more interacting components** that each warrant their own explanation

If the threshold is **not crossed**: proceed to step 4.

If the threshold **is crossed**: stop here. Tell the user:

> This project's documentation has outgrown what fits in a README. I recommend creating a wiki to house the deeper material. Run `/grill-with-docs` to design the wiki structure — it will leave a paper trail of ADRs and decisions. Then re-run `/update-docs` to sync the README with the new wiki.

Do not commit or write any files. The user runs the grilling session, designs the wiki, and returns.

**Completion:** A decision has been reached. Either we proceed to step 4, or the user has been told to run `/grill-with-docs` and the skill stops.

## 4. Update README.md

Write the README following every rule in [`README-STANDARDS.md`](./README-STANDARDS.md). Consult it during this step — it defines the mandatory sections, badge heuristics, diagram conventions, and voice rules.

Use color tokens from the [central color palette](../../colors/color-palette.md) for any Mermaid diagrams.

### If the README already exists

Edit it in place. Preserve any existing content that is still accurate. Add missing mandatory sections. Update sections that no longer reflect reality. Remove references to removed capabilities.

### If no README exists

Create it from scratch with all 8 mandatory sections. For sections where there is nothing to say yet (no tests, no CI, no wiki), write a single line: "Coming soon." This signals to future contributors that the section is expected, not forgotten.

### Badge detection

Check for each signal listed in the badge heuristics table. Add a badge only when the underlying thing actually exists. Place all badges on one line, space-separated, maximum 6.

### Documentation Index

Point to every piece of documentation that exists:

- Wiki: if a wiki repo exists (detectable via `git ls-remote <repo-url>.wiki.git`), link to it
- `docs/` files: list `CONTRIBUTING.md`, `CONTEXT.md`, and any other files present
- ADRs: if `docs/adr/` exists, link to it
- API docs: if Swagger/OpenAPI spec, GraphQL schema, or generated docs exist, link to them

For anything that will exist but does not yet, write "Coming soon."

### Voice check

After writing, run the three tests from the voice rules:
1. Can any sentence be deleted without losing meaning? Delete it.
2. Would a human write each sentence the same way? Rewrite anything that sounds like documentation-as-a-service.
3. Are there padding words? Cut "it is worth noting that", "as mentioned previously", "in order to", and their kin.

Run the anti-pattern check: no em dashes, no smart quotes, no "dive into" / "unleash" / "supercharge", no more than one emoji per section.

**Completion:** Every mandatory section is present and accurate. Every badge that should exist does. The Documentation Index points to everything that exists. The README passes the voice check.

## 5. Commit

Stage `README.md` and any other files changed. Determine the commit prefix:

- `docs(readme):` when only `README.md` changed
- `docs:` when `docs/` files were also touched

Write a commit message that summarizes the update in one line — a human reading `git log --oneline` should understand what documentation was brought up to date. Use the [conventional-commits](../../productivity/conventional-commits/SKILL.md) skill to produce the final message, then commit.

Do not push. The user decides when to push.

**Completion:** One commit with the appropriate prefix, staged locally.
