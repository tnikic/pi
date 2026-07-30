---
name: tdd
description: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.
---

# Test-Driven Development

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: which test types to write, what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle — consult them before and during the loop, not after.

When exploring the codebase, read `docs/CONTEXT.md` (if it exists) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching. Read `docs/TESTING.md` — it is the authoritative list of test and static-analysis tools with their exact invocation commands. If it does not exist, warn the user: "`docs/TESTING.md` is missing. Run `/tooling` first to set up the project's linting, formatting, and testing tools."

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification — "user can checkout with valid cart" tells you exactly what capability exists — and survives refactors because it doesn't care about internal structure.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Seams — where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test only at pre-agreed seams.** Before writing any test, write down the seams under test and confirm them with the user. No test is written at an unconfirmed seam. You can't test everything — agreeing the seams up front is how testing effort lands on the critical paths and complex logic instead of every edge case.

Ask: "What's the public interface, and which seams should we test?"

## Test types — which tests to write

Not every project needs every kind of test. The [test-type taxonomy](../../shared/test-types.md) defines each type — what it verifies, the project signals that trigger it, and what it is not for. Match the project against the taxonomy before writing tests. `docs/TESTING.md` is the authoritative portfolio — read it, do not re-research unless the user asks.

### Per-feature filtering (every cycle)

Before each red-green cycle, filter the portfolio: which types apply to *this vertical slice*?
- A slice that touches deployment or the startup path → **smoke test**
- A slice that delivers a user-facing behaviour → **E2E test**
- A purely internal refactor → unit and integration tests only
- A slice that changes an external API surface → **contract test**

### Spec-driving vs. gate tests

- **Spec-driving tests** (unit, integration): always write test-first — the test drives the design.
- **Gate tests** (smoke, E2E): write test-first when the interface is already stable (an existing CLI command, a deployed endpoint). When the interface itself is being built for the first time, gate tests come after — you cannot smoke-test a deploy mechanism that does not yet exist. The test is still written, just after the feature rather than before. Trust your judgement.

## Anti-patterns

- **Implementation-coupled** — mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological** — the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth — a known-good literal, a worked example, the spec.
- **Horizontal slicing** — writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead — one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review stage (see the `code-review` skill), not the red → green implementation cycle.
- **Gate tests may trail the loop.** Smoke and E2E tests can be written after the feature when the interface is new — see "Spec-driving vs. gate tests" above.
