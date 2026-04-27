# Testing Infrastructure

## Test Frameworks
**Unit/Integration:** Vitest 4.1.0 (`vitest`) with jsdom environment
**E2E:** Playwright 1.58.2 (`@playwright/test`)
**Coverage:** @vitest/coverage-v8 4.1.0 (V8 provider, reporters: text, html, lcov)
**Assertion Libraries:** Vitest built-in (`expect`), @testing-library/jest-dom 6.9.1, @testing-library/react 16.3.2, @testing-library/user-event 14.6.1

## Test Organization
**Location:** `tests/` directory at project root (unit, integration, e2e subdirectories) + `src/test/setup.ts` for global setup
**Naming:** Unit/Integration use `*.test.ts`; E2E uses `*.spec.ts` (numbered prefix for ordering: `01-`, `02-`, etc.)
**Structure:**
```
tests/
  unit/                          # Pure logic tests, mocked Supabase
    analytics.test.ts
    audio-recorder.test.ts
    job-tracker.test.ts
    permissions.test.ts
    sheet-positioning.test.ts
    time-variables.test.ts
    workflow-condition-evaluator.test.ts
    workflowPortability.test.ts
  integration/                   # Live Supabase (local or DEV), real DB operations
    setup.ts                     # Shared Supabase client + test constants
    lead-import.test.ts
    permission-engine.test.ts
    toggle-lead-ai.test.ts
    workflow-trigger.test.ts
  e2e/                           # Browser-based Playwright tests
    auth.setup.ts                # Shared auth — logs in once, saves session
    01-login-navigation.spec.ts
    02-create-move-lead.spec.ts
    03-import-leads.spec.ts
    04-workflow-basic.spec.ts
    05-operations-center.spec.ts
    fixtures/
      test-leads.csv             # CSV fixture for import tests
src/test/
  setup.ts                       # Global Vitest setup: imports @testing-library/jest-dom
```

## Vitest Configuration (`vitest.config.ts`)
- **Environment:** jsdom
- **Globals:** enabled (`describe`, `it`, `expect` available without import)
- **Setup file:** `./src/test/setup.ts` (loads `@testing-library/jest-dom`)
- **Include patterns:** `src/**/*.{test,spec}.{ts,tsx}`, `tests/**/*.{test,spec}.{ts,tsx}`
- **Exclude:** `node_modules`, `dist`, `.agent`
- **Path alias:** `@` maps to `./src`; `https://esm.sh/@supabase/supabase-js@2` maps to `@supabase/supabase-js` (for testing `_shared/` edge function files)
- **Coverage scope:** `src/lib/**`, `supabase/functions/_shared/**`

## Playwright Configuration (`playwright.config.ts`)
- **Test directory:** `./tests/e2e`
- **Parallel execution:** `fullyParallel: true` (workers: 1 in CI, unlimited locally)
- **Retries:** 2 in CI, 0 locally
- **Reporter:** `github` in CI, `html` locally
- **Base URL:** `http://localhost:8080`
- **Trace:** on-first-retry; **Screenshots:** only-on-failure
- **Browser:** Chromium only (Desktop Chrome)
- **Dev server:** auto-starts `npm run dev` if not already running (30s timeout)

## Testing Patterns

### Unit Tests
**Approach:** Pure function testing + Supabase client mocking via `vi.mock`
**Location:** `tests/unit/`

Unit tests fall into two categories:

1. **Pure logic tests** — no mocking needed. Directly import functions from `src/lib/` or `supabase/functions/_shared/` and assert outputs.
   - Examples: `workflow-condition-evaluator.test.ts` (tests `compare()` function with 21 operators), `time-variables.test.ts` (tests greeting/date logic), `workflowPortability.test.ts` (tests export/import/validation round-trip), `sheet-positioning.test.ts` (CSS class merging regression)

2. **Mocked Supabase tests** — use `vi.mock('@/integrations/supabase/client', ...)` to replace the Supabase client with `vi.fn()` stubs. Tests verify that application code calls Supabase correctly and handles responses/errors.
   - Examples: `permissions.test.ts` (mocks `rpc`, `from`, `getSession`), `analytics.test.ts` (mocks `insert`, `getUser`), `job-tracker.test.ts` (mock builder pattern with `createMockSupabase()`)

Pattern for mocked tests:
```typescript
const mockRpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
import { myFunction } from '@/lib/myModule';

describe('myFunction', () => {
  beforeEach(() => vi.clearAllMocks());
  it('does the thing', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    await expect(myFunction()).resolves.toBeUndefined();
  });
});
```

### Integration Tests
**Approach:** Real Supabase database operations against local or DEV instance
**Location:** `tests/integration/`

Integration tests connect to a real Supabase instance via `tests/integration/setup.ts`, which exports a `service_role` Supabase client and deterministic test IDs (`TEST_ORG_ID`, `TEST_MASTER_ID`, `TEST_ADMIN_ID`, `TEST_SDR_ID`).

- **Local mode:** Requires `supabase start` running at `http://localhost:54321` with seeded data
- **Skip mechanism:** `describe.skipIf(!process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true')` allows CI/local skipping
- **Cleanup:** `afterAll` hooks delete created records to avoid test pollution
- **One exception:** `toggle-lead-ai.test.ts` connects directly to the DEV Supabase instance (hardcoded URL/keys), creates a full user + team_member + leads test setup, and cleans up in `afterAll`

Pattern:
```typescript
import { supabase, TEST_ORG_ID } from './setup';
const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

describe.skipIf(shouldSkip)('Feature — integration', () => {
  afterAll(async () => { /* cleanup */ });
  it('inserts and queries correctly', async () => {
    const { data, error } = await supabase.from('table').insert({...}).select().single();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });
});
```

### E2E Tests
**Approach:** Full browser automation with Playwright, numbered for execution order
**Location:** `tests/e2e/`

- **Auth:** `auth.setup.ts` logs in once and saves session to `.playwright-auth/user.json`; uses env vars `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` with fallback defaults
- **Test credentials:** `admin@test.com` / `Test123!@#` (defaults)
- **Pattern:** Navigate to route, interact via accessibility selectors (`getByRole`, `getByPlaceholder`, `getByLabel`), assert URL/visibility
- **Resilience:** Tests use conditional visibility checks (`if (await btn.isVisible())`) to handle UI variations
- **Fixtures:** `tests/e2e/fixtures/test-leads.csv` for CSV import testing

### Workflow System Tests (Edge Function)
**Approach:** Shell script calling a Supabase edge function (`test-workflow-system`) that runs server-side tests
**Location:** `scripts/test-workflows.sh`
- Invoked via `bash scripts/test-workflows.sh [suite]` where suite is `all`, `triggers`, `conditions`, etc.
- Requires `SUPABASE_SERVICE_ROLE_KEY` env var; defaults to DEV Supabase URL
- Parses JSON response with `jq` and exits non-zero on failures

## Test Utilities & Setup Files

| File | Purpose |
|---|---|
| `src/test/setup.ts` | Global Vitest setup; imports `@testing-library/jest-dom` matchers |
| `tests/integration/setup.ts` | Creates `service_role` Supabase client; exports `TEST_ORG_ID`, `TEST_MASTER_ID`, `TEST_ADMIN_ID`, `TEST_SDR_ID` |
| `tests/e2e/auth.setup.ts` | Playwright auth setup; logs in and saves browser state to `.playwright-auth/user.json` |
| `tests/e2e/fixtures/test-leads.csv` | 3-row CSV fixture with nome, empresa, telefone, email columns |

## Test Execution

**Commands:**
- `npm run test` — Starts Vitest in watch mode (all unit + integration tests)
- `npm run test:run` — Single Vitest run (all unit + integration tests), exits after completion
- `npm run test:unit` — Vitest run for `tests/unit/` only, verbose reporter
- `npm run test:integration` — Vitest run for `tests/integration/` only, verbose reporter
- `npm run test:e2e` — Playwright test run (all E2E specs in `tests/e2e/`)
- `npm run test:coverage` — Vitest run for `tests/unit/` with V8 coverage (text + html + lcov output)
- `npm run test:all` — Sequential: unit, then integration, then e2e
- `bash scripts/test-workflows.sh` — Workflow system tests via edge function (requires `SUPABASE_SERVICE_ROLE_KEY`)

## CI Pipeline (`.github/workflows/test.yml`)

**Triggers:** push to `main`/`develop`, PR to `main`

| Job | Runs On | Dependencies | Steps |
|---|---|---|---|
| `unit-tests` | ubuntu-latest | None | `npm ci` → `npm run test:unit` → `npm run test:coverage` (continue-on-error) |
| `integration-tests` | ubuntu-latest | None | `supabase start` → `npm ci` → `npm run test:integration` (with env vars) |
| `e2e-tests` | ubuntu-latest | None | `supabase start` → `npm ci` → `npx playwright install chromium --with-deps` → `npm run build` → `npx playwright test` |
| `workflow-tests` | ubuntu-latest | `unit-tests` | `bash scripts/test-workflows.sh` (uses DEV secrets) |

**Node version:** 18
**Notes:**
- Integration and E2E jobs spin up a local Supabase via `supabase/setup-cli@v1`
- E2E builds the app first (`npm run build`) then runs Playwright against the build
- Workflow tests depend on unit tests passing first and use DEV environment secrets
- Coverage job uses `continue-on-error: true` (non-blocking)

## Test Coverage Matrix

| Code Layer | Required Test Type | Location Pattern | Run Command |
|---|---|---|---|
| `src/lib/**` (pure utilities) | Unit | `tests/unit/*.test.ts` | `npm run test:unit` |
| `supabase/functions/_shared/**` (edge function shared code) | Unit | `tests/unit/*.test.ts` | `npm run test:unit` |
| Supabase RPC / DB operations | Integration | `tests/integration/*.test.ts` | `npm run test:integration` |
| Permission engine (DB cascade) | Integration | `tests/integration/permission-engine.test.ts` | `npm run test:integration` |
| Lead import (DB flow) | Integration | `tests/integration/lead-import.test.ts` | `npm run test:integration` |
| Workflow triggers (DB flow) | Integration | `tests/integration/workflow-trigger.test.ts` | `npm run test:integration` |
| Login & navigation flows | E2E | `tests/e2e/01-*.spec.ts` | `npm run test:e2e` |
| Lead CRUD (create, move, import) | E2E | `tests/e2e/02-*.spec.ts`, `03-*.spec.ts` | `npm run test:e2e` |
| Workflow UI | E2E | `tests/e2e/04-*.spec.ts` | `npm run test:e2e` |
| Operations center | E2E | `tests/e2e/05-*.spec.ts` | `npm run test:e2e` |
| Workflow engine (server-side) | Edge function test | `scripts/test-workflows.sh` | `bash scripts/test-workflows.sh` |

## Parallelism Assessment

| Test Type | Parallel-Safe? | Isolation Model | Evidence |
|---|---|---|---|
| Unit tests | Yes | Fully isolated; Supabase mocked with `vi.mock` + `vi.fn()`; `beforeEach` clears mocks | Each test uses its own mock setup; no shared mutable state |
| Integration tests | Partially | Uses shared Supabase DB with deterministic test IDs; `afterAll` cleanup | Tests write to real DB tables; concurrent runs on same DB could conflict. `describe.skipIf` allows graceful skip |
| E2E tests | Yes (configured) | `fullyParallel: true` in Playwright config; each test gets isolated browser context | Playwright handles browser isolation. However, tests share the same Supabase backend — data-dependent tests could clash |
| Workflow system tests | No | Single HTTP call to edge function; sequential test runner inside the function | Shell script runs one curl command; server-side runner is sequential |

## Gate Check Commands

| Gate Level | When to Use | Command |
|---|---|---|
| Quick | After changes to `src/lib/`, `supabase/functions/_shared/`, or test-only changes | `npm run test:unit` |
| Integration | After changes to Supabase schema, RPC functions, RLS policies, or edge functions | `npm run test:unit && npm run test:integration` |
| Full | After UI changes, routing changes, or before merging feature branches | `npm run test:all` |
| Build | After phase completion or before release | `npm run build && npm run test:all` |
| Coverage | To assess test coverage gaps | `npm run test:coverage` |
