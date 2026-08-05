# Testing

## Commands

| Purpose | Command | Notes |
|---------|---------|-------|
| Run all tests | `npm test` | `tsx --test agent/extensions/**/*.test.ts` |
| Run single test file | `npx tsx --test agent/extensions/<ext>/<file>.test.ts` | Fast feedback during TDD |
| Lint | `npm run lint` | `biome lint --error-on-warnings` |
| Format | `npm run format` | `biome format --write` — run before committing |
| Full check | `npm run check` | `biome check --error-on-warnings` — lint + format check |

TypeScript type errors surface during `npm test` (tsx validates types at runtime). There is no standalone `tsc --noEmit` step — type checking is part of test execution.

## Test structure

Tests live alongside the modules they test under `agent/extensions/`:

```
agent/extensions/<extension>/
  index.ts              # Extension entry point
  engine.ts             # Pure logic modules imported by tests
  engine.test.ts        # Unit tests for engine.ts
  ...
```

- **Test runner**: Node.js built-in test runner (`node:test`), executed via `tsx`
- **Assertions**: `node:assert` (strict mode)
- **Test files**: `*.test.ts` glob matched by the `npm test` script
- **Pure modules first**: Extract logic from `index.ts` into dependency-free modules (like `engine.ts`, `toon-formatter.ts`, `concurrency.ts`) so tests don't need the pi runtime

## Biome overrides

Test files (`agent/extensions/**/*.test.ts`) have `suspicious/noExplicitAny` disabled — explicit `any` casts are tolerated in test helpers and mock setup.
