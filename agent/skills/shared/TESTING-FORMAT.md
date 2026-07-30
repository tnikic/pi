# TESTING.md Format

`docs/TESTING.md` is the authoritative list of every testing and static-analysis tool the project uses — and the exact command to run each one. Skills that test or review code read this file and execute the commands it specifies.

## Structure

```md
# Test portfolio — <project name>

## Static analysis

**<tool name>:** `<exact invocation command>` — <when it runs: on-save / pre-commit / CI>

## Test suite

**<test type>:** `<exact invocation command>` — <what it covers>

## Future

| Test type / tool | When | Why |
|---|---|---|
| <type> | <trigger condition> | <reason> |
```

## Rules

- **Every entry includes the exact invocation command.** `golangci-lint` is a tool name; `golangci-lint run ./...` is an entry. Only the latter goes in the file.
- **Static analysis** covers tools that check code without executing it: linter, formatter, typechecker. One entry per tool.
- **Test suite** covers tools that execute code: unit, integration, command-level, smoke, E2E, contract, performance. One entry per test type that applies. Use the [test-type taxonomy](../shared/test-types.md) for vocabulary.
- **Future** holds planned additions, each with a trigger condition. When the condition is met, the entry graduates to its section.
- **Omit empty sections.** A new project may have only Static analysis and Future.
- **This file specifies tools and commands.** Coverage targets and test data belong elsewhere.
