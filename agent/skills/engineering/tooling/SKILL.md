---
name: tooling
description: Set up and maintain a project's linting, formatting, and testing tools.
disable-model-invocation: true
---

# Tooling

Set up, update, or extend the project's development tooling — linter, formatter, typechecker, and test suite. Every tool and its exact invocation command is recorded in `docs/TESTING.md`, the single source of truth that `implement`, `code-review`, and `tdd` read to know what to run.

## Branches

Three entry points. Detect which applies:

- **No `docs/TESTING.md`** → first run (branch A).
- **`docs/TESTING.md` exists, user said "update" or "upgrade" or "check"** → subsequent run (branch B).
- **`docs/TESTING.md` exists, user asked to add a specific tool type** → add tool (branch C).

### A. First run

No `docs/TESTING.md` exists. Set up the project's tooling from scratch.

**1. Detect the ecosystem.** Check for language signals: `go.mod`, `package.json`, `Cargo.toml`, `pyproject.toml`, etc. If the repo is empty (no language signals found), ask: "What's the primary language for this project?" Wait for the answer.

*Completion: language identified.*

**2. Research the tools.** Fire a `/research` sub-agent with: "Find the best linter, formatter, and typechecker for a <language> project. For each, report: tool name, exact invocation command, how to install it locally in this project, and the recommended preset or config. Prefer tools that run fast and have opinionated defaults. Separate formatting from linting."

*Completion: research file written with findings for each tool category.*

**3. Present and confirm.** Show the user the recommendations, one tool per category:

> **Linter:** `golangci-lint run ./...` — install via `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest`
> **Formatter:** `gofmt -w .` — included with Go
> **Typechecker:** `go vet ./...` — included with Go

Ask: "These look right? Adjust any?" The user confirms or modifies.

*Completion: user confirms each tool and its invocation command.*

**4. Install.** Run the install command for each tool. If a tool is already installed, verify the version and move on.

*Completion: each tool's install command exits 0.*

**5. Write `docs/TESTING.md`.** Use the format in [`TESTING-FORMAT.md`](../../shared/TESTING-FORMAT.md). Populate the Static analysis section with the confirmed tools, each with its exact invocation command and when it runs. The Test suite section starts empty — `tdd` will populate it on first invocation.

*Completion: `docs/TESTING.md` written with every confirmed tool and its exact command.*

**6. Verify.** Run each tool once. Report any issues found — the user decides whether to fix them now or later.

*Completion: every tool executed at least once.*

### B. Subsequent run

`docs/TESTING.md` exists. Check whether the current tools are still the best choice.

**1. Read the current state.** Parse `docs/TESTING.md` for every tool, its invocation command, and the language ecosystem.

*Completion: current tool list extracted.*

**2. Research upgrades.** Fire a `/research` sub-agent with: "The project currently uses these tools: <list from TESTING.md>. For each, check: is it still the best-in-class choice for this language and ecosystem? Are there newer tools that have overtaken it? Also check: are any of these tools now deprecated, unmaintained, or superseded by a standard library alternative? For any replacement candidate, report the migration cost."

*Completion: research file written with upgrade candidates and cleanup targets.*

**3. Present.** Show upgrade candidates and tools to remove, side by side:

> **Upgrade:** `golangci-lint` → `golangci-lint v2` — faster, better defaults. Migration: update config.
> **Remove:** `gofmt` → now standard in `go fmt`, which is already in TESTING.md. Redundant.
>
> Make these changes?

*Completion: user confirms each upgrade and removal.*

**4. Apply.** Install new tools, remove unused ones, update `docs/TESTING.md` with the new commands. Verify each new tool runs.

*Completion: TESTING.md updated, tools installed and removed, each verified.*

### C. Add a tool

User asks to add a specific tool type ("add a contract test", "add a smoke test").

**1. Research the tool type.** Fire a `/research` sub-agent for the best tool in that category for this project's language.

*Completion: research file written.*

**2. Present and confirm.** Show the recommendation with installation and invocation. User confirms.

*Completion: user confirms the new tool entry.*

**3. Install, update, verify.** Install the tool, add it to the appropriate section of `docs/TESTING.md`, and run it once.

*Completion: tool installed, TESTING.md updated, tool verified.*
