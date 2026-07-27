---
name: conventional-commits
description: Create well-formed Conventional Commits messages from staged changes. Analyzes the diff to determine type, scope, and body; presents the message for approval before committing. Supports auto-splitting multi-scope changes. Use when the user wants to commit changes, create a commit, or draft a commit message.
---

# Conventional Commits

Create commits that follow the [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) specification — a structured format that communicates intent through typed, optionally scoped messages.

## Steps

### 1. Detect changes

Run `git status --short` and `git diff --cached --stat`. What happens next depends on what you find:

- **Nothing staged, nothing unstaged** → report "nothing to commit" and stop.
- **Nothing staged, unstaged changes present** → auto-stage everything with `git add -A`. If the user specified paths ("only the parser" / "just the config files"), stage only those paths instead.
- **Changes already staged** → use them as-is.

*Completion criterion: the staging area has changes to commit, or the skill exits with "nothing to commit."*

### 2. Run pre-commit safety checks

Two checks run against every new or modified file in the diff. Both must pass before proceeding.

**Secrets scan.** Inspect the diff for credentials, keys, and secrets — API keys, private keys, connection strings with embedded passwords, access tokens, `.env` files that aren't templates. Judge semantically: a placeholder key in a README is fine; a hardcoded secret in source is not. If a tool like `gitleaks` or `detect-secrets` is installed, run it as a second opinion.

**Lint and format.** Check whether the project has lint or format tooling — scan for `.pre-commit-config.yaml`, `lefthook.yml`, `package.json` lint scripts, `eslint`/`prettier`/`ruff`/`black` config, `Makefile` lint targets, or any linter configured in CI. If tooling exists, run the narrowest check that covers the changed files. If it fails, report the failures.

When either check fails, block the commit and report what was found. The user can override with "commit anyway" or "skip the checks."

*Completion criterion: both checks pass, or user explicitly overrides.*

### 3. Analyze the diff

Read `docs/conventional-commits.md` if it exists — it may define project-specific scopes or types. If it doesn't exist, auto-detect scopes from the codebase structure (top-level directories, package boundaries, major module folders).

For the diff, determine four things:

- **Type** — one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Infer from what the diff *does*: new capabilities → `feat`, bug corrections → `fix`, pure restructuring → `refactor`, test-only changes → `test`, dependency/script changes → `build` or `ci`, formatting/whitespace → `style`, documentation → `docs`, performance work → `perf`, catch-all maintenance → `chore`.
- **Scope** — if ≥70% of changed files fall under one scope, use it. Otherwise omit the scope. A scope is a short noun naming the affected area: `parser`, `auth`, `api`, `config`.
- **Body needed?** — two tiers. **Single line** for `docs`, `style`, `chore`, `test`, `ci`, `build`. **Body** for `feat`, `fix`, `refactor`, `perf`, `revert`, and any commit with a breaking change. A body explains what changed and why; it is free-form, wrapped at 72 characters.
- **Breaking change?** — scan for removed public APIs, changed function signatures, dropped compatibility, config format changes. If detected, mark with `!` after the type/scope and add a `BREAKING CHANGE:` footer (or use the `!` alone if the description captures it).

*Completion criterion: type, scope, body decision, and breaking-change detection determined.*

### 4. Suggest splitting (if applicable)

If the diff spans multiple scopes, propose splitting into one commit per scope — each a self-contained scope-based unit. Present the split plan:

```
I see changes across three scopes:

1. feat(parser): add array literal support
2. docs: update API reference for new parser syntax
3. chore(config): bump parser dependency version

Split into these three commits?
```

The user can accept the split, collapse into one commit (omitting scope), or adjust the groupings. If the diff is clearly single-scope, skip this step.

*Completion criterion: split plan accepted, or user chooses single commit, or step skipped.*

### 5. Craft the message

For each commit, build the message following the spec:

```
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

Rules:
- **Description** is imperative, present tense, sentence-case, no period at the end. It completes the sentence "This commit will…"
- **Body** (when tier dictates) explains *what* changed and *why*, wrapped at 72 characters, separated from the description by one blank line.
- **Footers** — auto-detect `Closes #N` or `Refs #N` from the branch name (e.g. `feat/42-parser` → `Refs: #42`). Add `BREAKING CHANGE: <description>` if a breaking change was detected and isn't fully captured by `!`. Separate footers from the body by one blank line.

*Completion criterion: one complete message per commit, formatted per spec.*

### 6. Present for approval

Show the full commit message(s) in a code block:

```
feat(parser): add array literal support

Introduce support for parsing array literals. Previously, arrays
would cause a parse error. This change handles square bracket
syntax and nested arrays.

Refs: #42
```

Ask "Ready to commit?" The user can accept, edit the message inline, or reject. If they edit, show the updated message and confirm again.

*Completion criterion: user accepts the message(s).*

### 7. Execute

Run `git commit -m "<message>"` for each commit. By default, signing respects the repository's git config (`commit.gpgSign`). To commit unsigned — for batch jobs or overnight automation — the user (or a calling skill) can request unsigned, and you pass `--no-gpg-sign`.

If the user requested splitting, commit each message in sequence. If any commit fails, stop and report the error.

*Completion criterion: all commits created successfully.*

## Reference

### Project config

`docs/conventional-commits.md` is the optional project-level config. When it exists, it may define:

```markdown
## Scopes
- parser
- auth
- api
- config

## Types (extends default set)
- deps  # dependency updates beyond chore
```

The skill reads this file on every run. Defaults (the eleven types, auto-detected scopes) apply for anything the file doesn't override.

### When to pick which type

| Type | Use when… |
|------|-----------|
| `feat` | Adding a new feature or capability |
| `fix` | Fixing a bug |
| `docs` | Documentation only |
| `style` | Formatting, whitespace, semicolons — no logic change |
| `refactor` | Restructuring code without fixing a bug or adding a feature |
| `perf` | Performance improvement |
| `test` | Adding or updating tests only |
| `build` | Build system, dependencies, package scripts |
| `ci` | CI configuration, pipelines |
| `chore` | Catch-all maintenance that doesn't fit the above |
| `revert` | Reverting a previous commit |

When a diff fits more than one type, prefer the most specific one. A change that adds a feature and includes its tests is `feat`, not `test`.

### Body triggers

Include a body when:
- The commit is `feat`, `fix`, `refactor`, `perf`, or `revert`
- The change has a breaking change
- The *why* isn't obvious from the description alone

Skip the body when:
- The commit is `docs`, `style`, `chore`, `test`, `ci`, or `build`
- The description fully captures the change

These are defaults — a `docs` commit that restructures the entire documentation deserves a body; a `fix` that corrects a typo in a string doesn't. Use judgment.
