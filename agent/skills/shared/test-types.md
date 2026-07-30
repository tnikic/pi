# Test-Type Taxonomy

A taxonomy of test types. The agent matches project signals against triggers to determine which types apply. Types are ordered from universal to situational.

## How to use

1. Read the project's signals — `package.json`, deploy config, Dockerfile, existing test suite.
2. For each type below, check whether its triggers fire. Start from the top.
3. Apply the lowest-level principle: write the test at the cheapest level that still gives you the confidence you need. If a unit test catches the bug, do not write an integration test. The most expensive test is the one written at the wrong level.
4. Present the portfolio to the user, confirm, persist to `docs/TESTING.md`.

---

## Static analysis

**What it verifies:** The code is free of typos, type errors, and known bug patterns — without executing anything. Linters and type-checkers.

**Triggers:** Always applies.

**Adding tools:** Check whether `docs/TESTING.md` or existing config files already specify linters. For any language without one, fire a research sub-agent to find the current best-in-class tool. Use the tool's recommended preset — do not build a custom ruleset from scratch. Separate formatting (delegate to an opinionated formatter) from linting (focus on correctness and bug detection). Over-configuration causes alert fatigue.

**Not for:** Runtime behaviour, integration contracts. Static analysis cannot tell you the assembled system works.

---

## Unit test

**What it verifies:** A single module, function, or class behaves correctly in isolation. No external dependencies.

**Triggers:** Always applies.

**Example:** `expect(calculateTotal([{ price: 10 }, { price: 5 }])).toBe(15)`

**Not for:** Testing module interactions, database writes, HTTP endpoints. If the test needs a network, filesystem, or database, it is not a unit test.

---

## Integration test

**What it verifies:** Two or more modules work together correctly through their real interfaces. May involve a real database, filesystem, or in-process server.

**Triggers:**
- Project has a database, message queue, or filesystem operations
- Multiple modules collaborate to deliver one behaviour
- The critical path crosses module boundaries

**Example:** Creating a user through the public API and verifying it is retrievable — exercising the full stack to the database and back. Use a real test database, not a mock, because ORM mappings and query planners are part of what you are testing.

**Not for:** Testing every edge case (unit tests own that), deployment health, third-party APIs you do not control.

---

## Contract test

**What it verifies:** An interface boundary between two systems is honoured — the provider sends what the consumer expects.

**Triggers:**
- Project consumes an external API (REST, GraphQL, gRPC)
- Project exposes an API consumed by other teams or services
- Project publishes a library

**Example:** A Pact test verifying the provider returns `{ id, name, email }` in the shape the consumer expects.

**Not for:** Business logic behind the boundary, full end-to-end flows, verifying the provider's internals.

---

## Smoke test

**What it verifies:** The application starts, its critical path does not crash, and basic health checks pass. Answers "is this build fundamentally broken?" — a gate, not a deep test.

**Triggers:**
- Project has a deploy step (CI/CD, Docker, binary release)
- Project is a CLI, server, or daemon that must start and stay up
- Project has external dependencies that must be reachable

**Example:** `mycli --version` exits 0; `mycli connect --host test` establishes a connection; server health endpoint returns 200.

**Not for:** Exhaustive functional verification, edge cases, performance benchmarks. Keep smoke tests to startup plus the single most critical path.

---

## End-to-end test

**What it verifies:** A complete user journey through the full system, deployed as in production. The pass condition is a user-observable outcome.

**Triggers:**
- Project has a user-facing interface (CLI, web UI, API)
- A vertical slice ticket claims to deliver "user can X"
- The system spans multiple services or processes

**Example (CLI):** `mycli deploy --env staging --app myapp` exits 0, app is reachable, `mycli status --app myapp` shows running.

**Example (web):** Browser automation: log in, create a resource, verify it appears, delete it, verify it is gone.

**Not for:** Testing every permutation, fast feedback during development, verifying internals. Reserve E2E for critical paths where no lower-level test gives equivalent confidence that the assembled system works. A flaky E2E test destroys trust in the suite.

---

## Performance / load test

**What it verifies:** The system meets latency and throughput targets under expected and peak load.

**Triggers:**
- Project serves concurrent users or requests
- A performance regression would be user-visible or violate an SLA
- Recent changes touched hot-path code, database queries, or network calls

**Example:** `wrk -t4 -c100 -d30s http://localhost:8080/api/items` — p99 latency under 200ms.

**Not for:** Correctness verification, every endpoint, every commit (expensive; run on a schedule or before major releases).

---

## Security test

**What it verifies:** The system is not vulnerable to common attack vectors — injection, broken auth, sensitive data exposure.

**Triggers:**
- Project handles user authentication or authorization
- Project accepts user input that reaches a database, filesystem, or network
- Project handles sensitive data (PII, credentials, payments)

**Example:** Dependency vulnerability checks (`npm audit`, `cargo audit`), SAST scanning, automated scripts verifying unauthenticated requests receive 401.

**Not for:** Replacing a manual security review, business logic correctness, performance testing.

---

## Accessibility test

**What it verifies:** The UI is usable by people with disabilities — screen readers, keyboard navigation, contrast ratios.

**Triggers:**
- Project has a web UI
- Project has a legal or compliance requirement (WCAG, Section 508)

**Example:** `axe-core` or `pa11y` scanning rendered pages for contrast violations, missing alt text, keyboard traps.

**Not for:** CLI tools, backend services, APIs with no UI.

---

## Visual regression test

**What it verifies:** The UI renders identically to a known-good baseline — no unintended visual changes from CSS, markup, or component refactors.

**Triggers:**
- Project has a web UI with custom styling
- Visual consistency is a product requirement
- A component library or design system is in use

**Example:** Percy or Chromatic screenshot diffing a button component before and after a CSS refactor.

**Not for:** Functional correctness, cross-browser testing (complementary), CLI or API projects.

---

## Cross-cutting principles

- **Confidence tracks resemblance.** The more your tests resemble how the software is used, the more confidence they give you. Earn the cost.
- **Debugging signal degrades as you go up.** A unit test failure points at a line. An E2E failure tells you something is broken — not where. Each E2E failure kicks off a debugging session.
- **Frontend-heavy projects may invert the pyramid.** For component-driven frontend codebases, prefer a large integration layer and smaller unit/E2E layers — testing components in isolation often mocks away the behaviour you care about.
- **Start linters from the preset.** Use the tool's recommended rules. Only add rules with a specific, articulable reason. An over-configured linter causes alert fatigue.
- **Every bug gets a regression test.** Write a test that reproduces the bug before fixing it. If no correct seam exists to hang the regression test on, that is itself a finding — flag it for improve-codebase-architecture.
