# Concerns

**Analyzed:** 2026-04-01

---

## Security

### [CONCERN-S1]: Service Role Key Exposed in `.env.development`
**Severity:** Critical
**Location:** `.env.development` (line 14)
**Evidence:** The file contains `VITE_SUPABASE_SERVICE_ROLE_KEY` with a live JWT for the DEV Supabase project (`bcfadphgsibjzivtbjvc`). The `VITE_` prefix means Vite injects this into the client bundle at build time. Although `.env.development` is in `.gitignore` and not tracked, any `npm run dev` build exposes the service role key in browser-accessible JavaScript. The service role key bypasses all RLS policies, granting full read/write access to every table.
**Fix approach:** Remove the `VITE_SUPABASE_SERVICE_ROLE_KEY` line from `.env.development` immediately. Service role keys must never carry the `VITE_` prefix. If any code references `import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY`, refactor it to use edge functions with the key server-side only. Rotate the DEV project service role key.

### [CONCERN-S2]: Hostinger API Token Hardcoded in `.env`
**Severity:** High
**Location:** `.env` (line 17)
**Evidence:** `HOSTINGER_API_TOKEN` is present with a real credential. While `.env` is in `.gitignore` and not currently tracked by git, this token is a non-`VITE_` prefixed secret sitting in the same file as frontend config, creating risk of accidental commit.
**Fix approach:** Move server-only secrets (`HOSTINGER_API_TOKEN`) to a separate `.env.server` or CI/CD secrets. Rotate the token. Add a pre-commit hook that scans for secrets.

### [CONCERN-S3]: All Edge Functions Deployed with `verify_jwt = false`
**Severity:** Critical
**Location:** `supabase/config.toml` (all 49 function entries)
**Evidence:** Every single edge function in `config.toml` has `verify_jwt = false`. While some functions legitimately need this (webhooks, cron triggers), user-facing functions like `import-leads`, `create-org-user`, `list-lead-forms`, `send-meta-message`, `checkout-create-payment`, `elevenlabs-proxy`, and all Google Calendar/TinyERP functions also disable JWT verification. Comments indicate "JWT validated internally" for some, but this creates a fragile security boundary where forgetting internal validation in any function leaves it completely open.
**Fix approach:** Audit each function. Re-enable `verify_jwt = true` for all user-facing functions that should require authenticated users. Keep `verify_jwt = false` only for webhooks (Meta, Cal.com, TinyERP, Asaas), cron-triggered functions, and the CORS-preflight-sensitive functions that truly need it. For the latter group, ensure every function validates the JWT token internally and rejects unauthenticated requests.

### [CONCERN-S4]: `import-leads` Edge Function Lacks User Authentication
**Severity:** High
**Location:** `supabase/functions/import-leads/index.ts` (lines 1-17), `src/hooks/useImportLeads.ts` (lines 1095-1103)
**Evidence:** The `import-leads` function is deployed with `--no-verify-jwt` and the frontend calls it with only the `apikey` header (anon key), without passing the user's session `Authorization` header. The function validates `organization_id` exists in the DB but does not verify the caller is a member of that organization. Anyone with the public anon key (available in the client bundle) can import leads into any organization by guessing/knowing the organization UUID.
**Fix approach:** Pass the user's `Authorization: Bearer <session_token>` header from the frontend. In the edge function, extract the user from the JWT, verify membership in the target organization via `team_members` table, and reject unauthorized requests.

### [CONCERN-S5]: Email Confirmation Disabled
**Severity:** Medium
**Location:** `supabase/config.toml` (line 6)
**Evidence:** `enable_confirmations = false` in the auth.email config. This means any email address can be used to create an account without verification, enabling account enumeration, impersonation, and spam sign-ups.
**Fix approach:** Enable email confirmations for the production environment. The comment says "SDR/equipe interno" but the system has a public signup page (`/signup`). If internal-only, remove the public signup route and gate user creation through the admin `create-org-user` flow exclusively.

### [CONCERN-S6]: Meta App ID Exposed as Non-Secret in `.env`
**Severity:** Low
**Location:** `.env` (line 15), `.env.development` (line 20)
**Evidence:** `VITE_META_APP_ID` is present. While Meta App IDs are semi-public, having them in the `.env` file alongside other credentials normalizes the pattern of putting sensitive values in env files. This is a low-severity observation.
**Fix approach:** No immediate action required. Consider documenting which env vars are public vs. secret.

---

## Architecture Debt

### [CONCERN-A1]: Extreme File Sizes -- 30+ Files Over 800 Lines
**Severity:** High
**Location:** Multiple files (sorted by line count):
- `src/integrations/supabase/types.ts` (8,695 lines -- auto-generated, acceptable)
- `src/components/chat/WhatsAppChat.tsx` (2,434 lines)
- `src/components/automacoes/sidebar-panels/ActionPanel.tsx` (1,654 lines)
- `src/pages/PipePropostas.tsx` (1,489 lines)
- `src/components/leads/LeadDetailDrawer.tsx` (1,486 lines)
- `src/hooks/useCampanhas.ts` (1,477 lines)
- `src/pages/Performance.tsx` (1,443 lines)
- `src/hooks/useImportLeads.ts` (1,411 lines)
- `src/pages/Agenda.tsx` (1,385 lines)
- `src/components/copilot/CopilotWizard.tsx` (1,188 lines)
- `src/components/campanhas/CreateCampanhaModal.tsx` (1,163 lines)
- `src/hooks/useWhatsAppChat.ts` (1,091 lines)
- And 20+ more files between 800-1,090 lines
**Evidence:** 167,598 total lines across 649 source files. The median component/hook is significantly larger than recommended. `WhatsAppChat.tsx` at 2,434 lines is a monolithic component mixing UI rendering, message handling, audio recording, file uploads, scheduling, and real-time subscriptions.
**Fix approach:** Decompose the largest files into focused subcomponents. For example, `WhatsAppChat.tsx` should be split into `ChatMessageList`, `ChatInput`, `AudioRecorder`, `FileUploader`, `ScheduleMessage`, etc. Extract shared logic into custom hooks. Target maximum 300-400 lines per component, 500 for hooks.

### [CONCERN-A2]: Orphaned `orchestration/`, `execution/`, `directives/` Directories
**Severity:** Medium
**Location:** `/orchestration/`, `/execution/`, `/directives/`
**Evidence:** These three directories at the project root contain TypeScript modules (`orchestration/agent.ts`, `orchestration/executor.ts`, `orchestration/directive-reader.ts`) and shell scripts (`execution/deploy_hostinger_vps_api.sh`), but zero imports from `src/` reference them: `import.*from.*orchestration` returns no matches. The `orchestration/index.ts` exports `Agent`, `DirectiveReader`, and `Executor` classes, but nothing in the application uses them. These appear to be a standalone agent-orchestration experiment that was never integrated.
**Fix approach:** Decide: integrate or remove. If these are intended for future use, move to a separate package or clearly mark as WIP. If abandoned, remove them to reduce cognitive overhead.

### [CONCERN-A3]: 20+ Ad-Hoc SQL and Markdown Files at Project Root
**Severity:** Medium
**Location:** Root directory: `ADD_USER_SEPARATION.sql`, `CRIAR_ORGANIZACAO.sql`, `CRIAR_ORGANIZACAO_ADMIN.sql`, `DIAGNOSTICO_ORGANIZACAO.sql`, `FIX_COPILOT_COLUMNS.sql`, `FORCAR_VINCULO_ORGANIZACAO.sql`, `SOLUCAO_DEFINITIVA_RLS.sql`, `SOLUCAO_EMERGENCIAL_RLS.sql`, `VERIFICAR_COPILOT_RLS.sql`, `VINCULAR_ORGANIZACAO.sql`, plus 15+ `.md` files (`ANALISE_LOGGING_SAAS.md`, `ARQUITETURA_3_CAMADAS.md`, `GUIA_ERRO_500.md`, `IMPLEMENTACAO_COMPLETA.md`, etc.)
**Evidence:** These are one-off debug/fix scripts and operational guides dumped at the project root. Some `.sql` files are in `.gitignore` but others are not ignored and could be tracked. The `.md` files are not ignored.
**Fix approach:** Move operational SQL scripts to `scripts/sql/` or `supabase/scripts/`. Move documentation to `docs/`. Add remaining root-level SQL files to `.gitignore`. Clean up the project root.

### [CONCERN-A4]: 131+ Migration Files with Layered RLS Fixes
**Severity:** High
**Location:** `supabase/migrations/` (131+ files)
**Evidence:** The migration directory contains an extremely high count of migrations, many of which are iterative patches to RLS policies. Examples: `fix_rls_policies`, `fix_leads_update_rls_allow_reassign`, `fix_pipe_confirmacao_closer_visibility`, `nuclear_fix_leads_closer_visibility`, `fix_team_member_permissions_rls`, `fix_master_missing_rls_and_add_second_master`, `fix_leads_rls_use_feature_permissions`, `fix_pipe_rls_responsible_id`. The naming reveals a pattern of reactive fixes rather than a cohesive, tested security model. There are also duplicate migration names.
**Fix approach:** Consider a migration squash to consolidate the current state into a clean baseline. Establish a thorough RLS testing framework (use Supabase's `pgTAP` or a custom test suite) so policy changes are verified before deployment. Document the security model in a single canonical reference.

### [CONCERN-A5]: `@dnd-kit/utilities` Used But Not Declared in `package.json`
**Severity:** Low
**Location:** `src/components/pipelines/ManagePipelineStagesModal.tsx`, `src/components/campanhas/CampanhaKanban.tsx`, `src/components/kanban/DraggableKanbanBoard.tsx`, `src/components/custom-pipelines/CustomPipeSettingsDialog.tsx`, `src/components/campanhas/ManageStagesModal.tsx`
**Evidence:** Five files import `CSS` from `@dnd-kit/utilities`, but the package is not listed in `package.json` dependencies. It works because `@dnd-kit/sortable` pulls it as a transitive dependency, but this is fragile.
**Fix approach:** Add `@dnd-kit/utilities` explicitly to `package.json` dependencies.

---

## Performance

### [CONCERN-P1]: 108 Queries Using `select("*")` Across 58 Files
**Severity:** Medium
**Location:** 58 hook and component files (top offenders: `src/hooks/useCopilotAgents.ts` with 10 occurrences, `src/hooks/useCustomPipelines.ts` with 6, `src/hooks/useCampanhas.ts` with 5, `src/hooks/useTeamMembers.ts` with 4)
**Evidence:** 108 Supabase queries use `.select("*")`, fetching all columns including potentially large text fields, JSON blobs, and unnecessary metadata. For tables like `leads`, `conversations`, or `copilot_agents` which can have many columns, this transfers significantly more data than needed over the wire.
**Fix approach:** Replace `select("*")` with explicit column lists for the fields actually used by the UI. Prioritize high-frequency queries (leads, conversations, team_members) and large tables first.

### [CONCERN-P2]: N+1 Query Patterns in Loops
**Severity:** Medium
**Location:**
- `src/components/products/ProductImportModal.tsx` (line 353): `for` loop with individual `supabase.from("products").update()` per SKU
- `src/hooks/useCopilotAgents.ts` (line 966-973): `for` loop with sequential `supabase.storage.remove()` + `supabase.from().delete()` per document
- `src/hooks/useExportLeads.ts` (line 140-145): Batched (good pattern), but still N/50 sequential rounds
**Evidence:** The product import iterates parent SKUs and fires an individual `UPDATE` per SKU. The copilot agent document removal loops through documents sequentially instead of batching. These create waterfall request patterns.
**Fix approach:** Batch the product updates into a single RPC or use `in()` filter. For document removal, collect all file paths and delete in a single `supabase.storage.remove([...paths])` call, then batch the DB deletes.

### [CONCERN-P3]: `xlsx` and `lamejs` Bundle Impact
**Severity:** Low
**Location:** `package.json` dependencies, `src/hooks/useImportLeads.ts`, `src/hooks/useExportLeads.ts`, `src/lib/audioToMp3.ts`
**Evidence:** Both `xlsx` (~1MB) and `lamejs` are in production dependencies. However, the codebase correctly uses dynamic imports (`await import("xlsx")`) for xlsx and loads lamejs via a separate script tag (`/lamejs.min.js`), so they do not bloat the main bundle. The `vite.config.ts` also has proper `manualChunks` splitting.
**Fix approach:** No immediate action needed. The dynamic import pattern is correct. Consider adding `xlsx` to the `manualChunks` config if it appears in the common chunk.

### [CONCERN-P4]: 99 Silent Error Swallows (`catch {}` / `catch () {}`)
**Severity:** Medium
**Location:** 59 files across the `src/` directory (99 total occurrences)
**Evidence:** Widespread use of empty catch blocks that silently discard errors. While some are intentional (e.g., parsing fallbacks in `AuthContext.tsx`), many hide real failures. In hooks that make Supabase calls, silent catches prevent users from seeing error feedback and make debugging production issues significantly harder.
**Fix approach:** Audit each empty catch block. For user-facing operations, add `toast.error()` or Sentry reporting. For truly ignorable errors, add a comment explaining why. Consider a lint rule (`no-empty` or `@typescript-eslint/no-empty-function`).

---

## Testing Gaps

### [CONCERN-T1]: 20 Test Files for 649 Source Files (3% Coverage)
**Severity:** Critical
**Location:** `tests/unit/` (8 files), `tests/integration/` (5 files + setup), `tests/e2e/` (5 files + setup)
**Evidence:** The project has 649 source files but only 20 test files total. No tests exist inside `src/` (zero `.test.ts` or `.test.tsx` co-located files). The test infrastructure is set up (vitest, playwright, testing-library) but barely used.
**Fix approach:** Prioritize test creation for critical paths first. See CONCERN-T2 through CONCERN-T5 for specific gaps.

### [CONCERN-T2]: Authentication and Authorization Flows Untested
**Severity:** Critical
**Location:** `src/contexts/AuthContext.tsx`, `src/hooks/useUserRole.ts`, `src/hooks/usePermissions.ts`, `src/lib/permissions.ts`, `src/components/ProtectedRoute.tsx`, `src/components/PermissionProtectedRoute.tsx`
**Evidence:** No unit tests for the auth context, role resolution, permission checks, or route protection logic. These are the security boundary of the application. The e2e test `01-login-navigation.spec.ts` exists but only covers the happy path.
**Fix approach:** Write unit tests for `AuthContext` (sign-in, sign-up, sign-out, session refresh), `usePermissions` (all role combinations), and `PermissionProtectedRoute` (authorized, unauthorized, loading states).

### [CONCERN-T3]: Checkout/Payment Flow Untested
**Severity:** High
**Location:** `src/hooks/useCheckout.ts`, `src/components/checkout/`, `supabase/functions/checkout-create-payment/`, `supabase/functions/asaas-webhook/`
**Evidence:** Zero tests for the payment creation flow, PIX QR code generation, webhook handling, or organization provisioning. Financial operations are the highest-risk area for bugs that cause real monetary loss.
**Fix approach:** Write integration tests for `useCheckout` with mocked Supabase responses. Write unit tests for the edge functions' payment validation logic. Test the Asaas webhook handler with sample payloads.

### [CONCERN-T4]: Data Mutation Hooks Untested
**Severity:** High
**Location:** All 100+ hooks in `src/hooks/` (e.g., `useLeads.ts`, `useCampanhas.ts`, `useCopilotAgents.ts`, `useImportLeads.ts`)
**Evidence:** The hooks contain complex business logic (lead deduplication, campaign distribution, workflow execution, import parsing) but have zero unit tests. Only `tests/unit/permissions.test.ts` and `tests/unit/workflow-condition-evaluator.test.ts` cover hook-adjacent utility logic.
**Fix approach:** For each critical hook, write tests that verify: (1) correct Supabase query construction, (2) error handling, (3) state transitions, (4) edge cases like empty data, duplicate entries, permission boundaries.

### [CONCERN-T5]: RLS Policies Untested Programmatically
**Severity:** High
**Location:** `supabase/migrations/` (131+ migration files with RLS policies)
**Evidence:** The repeated "fix RLS" migrations (see CONCERN-A4) indicate policies are being tested manually in production. No `pgTAP` tests or Supabase test helpers exist to verify that RLS policies correctly isolate data between organizations, roles (admin vs. member vs. closer), and ownership boundaries.
**Fix approach:** Implement `pgTAP` or equivalent tests that: create test users in different roles/orgs, attempt cross-tenant data access, and verify denials. Run these in CI before migration deployment.

---

## Dependencies

### [CONCERN-D1]: `lovable-tagger` -- Lovable Platform Artifact
**Severity:** Medium
**Location:** `package.json` (devDependencies, line 105), `vite.config.ts` (line 4, 30)
**Evidence:** `lovable-tagger` v1.1.13 is a Vite plugin from the Lovable AI platform (lovable.dev). It adds data attributes to React components for Lovable's visual editor to identify them. It is only active in development mode (`mode === "development" && componentTagger()`). This reveals the project was initially scaffolded or developed on the Lovable platform. The plugin brings its own bundled copy of `esbuild`, adding unnecessary weight to `node_modules`.
**Fix approach:** If the Lovable platform is no longer used for development, remove `lovable-tagger` from devDependencies, remove the import and plugin call from `vite.config.ts`, and run `npm install` to clean up. If still used, no action needed.

### [CONCERN-D2]: `@dnd-kit/utilities` Phantom Dependency
**Severity:** Low
**Location:** See CONCERN-A5
**Evidence:** Used by 5 components but not declared in `package.json`. Works via transitive dependency from `@dnd-kit/sortable`.
**Fix approach:** Add `"@dnd-kit/utilities": "^3.2.2"` to `package.json` dependencies.

### [CONCERN-D3]: `next-themes` Used Outside Next.js
**Severity:** Low
**Location:** `package.json` (line 66), `src/App.tsx` (line 2: `import { ThemeProvider } from "next-themes"`)
**Evidence:** The project is a Vite/React SPA, not a Next.js application, but uses `next-themes` for theme management. While `next-themes` technically works in non-Next environments, it is designed for and optimized for Next.js SSR. Using it in a pure SPA may cause hydration warnings or unnecessary complexity.
**Fix approach:** Low priority. It works. If theme issues arise, consider migrating to a lighter solution or custom `ThemeProvider`.

### [CONCERN-D4]: `@types/papaparse` Listed as Production Dependency
**Severity:** Low
**Location:** `package.json` (line 56)
**Evidence:** `@types/papaparse` is a TypeScript type definition package that should be in `devDependencies`, not `dependencies`. It has no runtime impact but signals sloppy dependency management.
**Fix approach:** Move `@types/papaparse` and `@types/react-big-calendar` from `dependencies` to `devDependencies`.
