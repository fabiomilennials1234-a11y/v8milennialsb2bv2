# Implementation evidence — condicional guiado

Goal: complete all 21 approved tickets with TDD, real integration, UI checks and rollback; return to HITL only after full completion. **No ticket certified complete yet.**

## Workspace and tracking

- Worktree: /Users/gabrielaureliogipp/Dev/wt-condicional-audit-main-20260907
- Branch: codex/condicional-guiado. Original dirty checkout preserved.
- PRD #2015 unchanged. All 21 issues #2016–#2036 published with ready-for-agent and native dependency sets independently verified. Mapping: issues.json. #2016 assigned to current account.
- Approved seams: public evaluation service; editor/publication browser E2E; real database access, versions and resumption. No new confirmation needed.
- Clean npm ci completed (1170 packages). Current Vitest 4.1.0 from lockfile.

## Implemented so far (ticket 01 partial)

- guided-condition.ts: separate new contract, name equality ignores case/accents; explicit empty operator; validates configuration; error outcomes distinct from boolean; personal reads use caller-scoped Supabase client, filter org/lead/deleted_at.
- guided-condition-test.ts and test-guided-condition/index.ts: public personal-test HTTP endpoint, real requireAuth middleware resolves/validates org membership; lead data fetched with caller JWT (never service credential). Anonymous, unsupported method, bad JSON, preflight covered. No commercial actions or shadow-member provisioning.
- GuidedConditionPanel.tsx: browser-tested panel with typed comparison selector, optional text value, bounded lead lookup/search (25 options, debounce, query cancellation), empty/error/loading handling, caller test, protected error and explanation. Result tied to tested configuration/context.
- **Panel not yet wired into actual ConditionPanel / AutomacoesEditor / node creation.** Existing workflows/executor untouched. No automatic execution of new condition implemented.
- Tests only existing name source so far. Full catalog, groups, grants, versions, worker, retry, history, portability, migration all remain.

## Verification

- Latest unit suite: 4 files / 96 passing (5 new evaluator + 5 HTTP + 86 legacy evaluator tests).
- Browser suite: 5 passing in Chromium (configured comparison, cleared stale result after edit, empty operator + keyboard, protected access error, bounded server search, empty-list state). Harness uses fixed fake external transport; this is NOT full live editor E2E.
- Real deployed HTTP integration: 2 passing. Covers authorized lead, cross-org manipulated lead/org IDs, explicit responsible-only member access, current membership revocation while token stays valid. Runs actual Auth/PostgREST/RLS and deployed endpoint. Runner: node scripts/test-guided-preview.mjs mkpjjtwjyvgabavnxqgp.
- Last integration rerun after lint cleanup changes passed: 2 tests, session 92730 terminal.
- Deno endpoint check passed. Earlier typecheck:ratchet passed with 0 introduced errors (805 baseline + 11 inherited); rerun after next source changes. Focused ESLint new implementation passed; unsafe-finally errors in fixtures fixed by aggregating cleanup/test failures; latest lint invocation passed before integration rerun.
- git diff --check clean.

## Preview environment — MUST clean up when validation ends

- Ref mkpjjtwjyvgabavnxqgp; branch id 27aafdf8-b04a-4513-beaa-3aac4d1e554b; name codex-condicional-20260907. Non-default ACTIVE_HEALTHY, created WITHOUT production data.
- Creation/replay complete; session 96825 terminal. **Do not restart replay.** Log: /tmp/condicional-guided-preview-migrations.log.
- 317/318 repository migrations applied, 302 public tables. Sole inherited failure: 20270925000000_aposenta_calor_e_rating.sql asserts backup count >0, but empty preview has zero source and backup rows. Later schema replay succeeded. Name/auth tests do not depend on retired rating. Do not claim perfect schema parity; resolve relevant drift before certifying full feature. Do not blindly replay old migration now: later migrations replace overlapping functions.
- Feature migrations 20271017000000 and 20271017000001 applied on preview and registered in ledger. Both have rollback SQL. Combined rollback/reapply rehearsal passed with a synthetic revision-7 approval preserved, permissions revoked/restored and exact function definition restored. See grants-and-rollback.md and scripts/check-guided-grant-rollback.mjs. Never edit these applied files.
- Endpoint test-guided-condition deployed to this preview with --use-api; config verify_jwt=false because requireAuth validates user JWT. Anonymous real request denied. No production deploy.
- Runbook: .specs/project/runbook-validacao-local.md. Docker is forbidden; old dev bcfadphgsibjzivtbjvc retired. Only one preview at a time. Runbook cost ~US$0.01344/hour; delete when testing ends, do not leave indefinitely.
- Credentials retrieved into memory via CLI by scripts/test-guided-preview.mjs; none written to repo. Temporary fake .env.development.local removed. Browser harness fixed env in its own Playwright config.
- Fixture lessons: org needs org_quotas max_users before member insert; cleanup clears default_pipeline_id then deletes leads/stages/reclassify queue/pipelines before org (existing cascade bug documented in migration 20270918000000). Physical role key is member (domain Membro), as current Equipe/useUserRole do. Catalog grants leads.view_all by default; restrictive test explicitly denies view_all/view_unassigned/view_subordinates for member.
- First failed fixture run left two orgs; both explicitly cleaned with correct stage order (/tmp/condicional-clean-initial-fixtures.sql). Its first synthetic auth user may remain until preview teardown. Later fixture runs clean their own users/orgs successfully.

## Next concrete work

1. Continue ticket 01 editor wiring. Panel is wired through the real AutomacoesEditor and WorkflowSidebar, including session organization and development-only new-node creation. All execution handles from this turn are terminal.
2. Integrate new draft on newly created conditions under controlled dev activation; keep legacy nodes unchanged. Prevent unsupported automatic execution/publication until org grants and versions implemented (tickets 02–04). Test guards through approved public seams.
3. Continue vertical slices in approved DAG. Do not declare ticket 01 complete merely because current test subset passes.
4. Keep all 21 requirements and rollback proof in completion audit. Return to HITL only after all are implemented and verified.

## Ticket state

- 01: #2016 — in progress; editor wiring and complete acceptance proof pending
- 02: #2017 — in progress; scoped admin grant CRUD and UI verified; organizational evaluator/runtime consumption still pending
- 03: #2018 — in progress; separate draft persistence and concurrency verified; immutable publication and editor integration pending
- 04: #2019 — not started
- 05: #2020 — not started
- 06: #2021 — not started
- 07: #2022 — not started
- 08: #2023 — not started
- 09: #2024 — not started
- 10: #2025 — not started
- 11: #2026 — not started
- 12: #2027 — not started
- 13: #2028 — not started
- 14: #2029 — not started
- 15: #2030 — not started
- 16: #2031 — not started
- 17: #2032 — not started
- 18: #2033 — not started
- 19: #2034 — not started
- 20: #2035 — not started
- 21: #2036 — not started


## 2026-09-08 — editor integration and grant approval

- Real editor browser harness now uses AuthProvider, organization resolution and AutomacoesEditor; only external Auth/PostgREST/function transport fixtures are substituted. Fixed missing organization propagation from editor to sidebar.
- New condition creation uses guided contract only when Vite DEV and VITE_GUIDED_CONDITIONS=true. Saved legacy conditions remain unchanged. No production activation.
- Executor scans the complete definition and rejects any guided draft before actions with guided_publication_required. This is a temporary closed gate until published authorized runtime exists, NOT completion of automatic execution. Shared node-requirements gate also blocks editor/list activation and explains missing publication.
- WorkflowDataGrantPanel explains organization-wide lead-name scope, reads current approval, approves/revokes with revision check and refreshes state after conflict. Server resolves organization from workflow and uses existing administrative authorization helper.
- Database security verified on target: RPC anon=false/authenticated=true/service_role=false, direct authenticated INSERT/UPDATE=false. No implicit grants created for any workflow. Grant storage and function are additive; creator's active membership is not authorization.
- Live tests caught revision conflict 40001 timing out (60s, reproduced with bounded 8s request). Added second migration returning PT409/HTTP409; original migration unchanged. Latest real integration passed all 3 tests, including personal tenant isolation, responsible-only RLS, membership revocation, administrator approval/revocation, stale revision, unsupported field, cross-org workflow ID, forged direct insert, non-admin refusal, protected grant read and approval surviving creator's deactivation.
- Existing workflows.created_by FK restricts auth-user deletion; synthetic workflows must be deleted before synthetic creators. Fixture cleanup fixed. A failed run may have left another synthetic auth account until preview teardown; subsequent fixtures clean correctly. No customer records used.
- Latest verified sets: 238 unit/legacy tests in 10 files; 9 browser cases; 3 live integration cases. Focused ESLint and git diff --check pass. Typecheck ratchet including grant-panel changes passed: 0 introduced errors; 805 baseline + 11 inherited tolerated. All execution handles from this turn are terminal.
- Both migrations were rehearsed in reverse rollback order then original apply order in one real preview transaction; preserved grant data and exact restored function definition verified. No ongoing SQL rehearsal or integration process after those results.
- Next meaningful work: implement organizational evaluation consuming current explicit grant, with current authorization rechecked on every data access; then immutable published versions and pinned execution. Complete ticket-01 review/proof; do not close tickets just because this narrower subset passes. Preserve all 21 tickets and final HITL only after full verification.


## 2026-09-08 — organizational evaluation and separate drafts

- Organizational authorization is now consumed by evaluateGuidedCondition via explicit request.authorization={kind:organization,workflowId}. Service-only read_guided_condition_lead checks workflow/org identity, current explicit lead.name grant and unblocked organization in the same transaction as the lead read. SHARE locks prevent completed revocation between check and access. Missing/cross-org grants deny; missing/cross-org/deleted lead is context_unavailable. No unrestricted service fallback. Unknown authorization modes deny explicitly.
- Migration 20271017000002 applied to preview with reverse SQL; grants verified live: anon=false, authenticated=false, service_role=true. Existing personal-test endpoint never copies a supplied authorization mode into the internal request.
- Real tests prove organization reads are available only while granted, unavailable to user clients (even admins), cross-org IDs cannot substitute context, revocation affects the next evaluation and creator deactivation does not revoke the independent organizational grant.
- Migration 20271017000003 adds workflow_guided_drafts and save_guided_workflow_draft. Draft saves are explicit, accept incomplete condition configuration, preserve workflows.definition, and serialize by workflow/revision. Two simultaneous saves from revision 1 produce one success and one PT409; resulting revision 2 contains exactly the winning definition. Admin-only RLS/read and RPC write; direct writes denied. No publication implementation yet.
- Draft and authorized-read migrations registered in preview ledger. Rollback rehearsal extended to all four migrations, preserving synthetic approval revision 7 and draft revision 11 while denying access during rollback and restoring grants/function contracts on reapply.
- New checks: 12 evaluator/API/execution unit tests pass; five live integration cases pass including concurrency and permissions. Deno check caught missing RPC return typing; explicit returns<...> added, then check passed. Focused ESLint passed. Personal-test endpoint redeployed to preview only; post-deploy integration passed all five cases.
- Current user-facing guided execution remains closed pending publication and execution-version pinning. The original 21-ticket scope remains intact. No ticket certified complete and no HITL requested.
- Security review follow-up: verify administrative parity for full master versus org admin/gestor. Current grant/draft policies use get_my_admin_organization_ids (org admins + bound gestores); UI resolves full master to virtual admin, which may expose a button that its database policy denies. Do not broaden via is_master_user without checking restricted outbound master permissions.
- Next: code review of checkpoint, then immutable publication using validated complete definitions and current grants. Keep saved drafts distinct from live versions; integrate actual editor save/load. Existing shared workflow-schema validator should be reused for graph invariants, not reimplemented casually in SQL.

## 2026-09-08 — review fixes: identity isolation and incomplete comparisons

- Standards review of 7ce7fc74...489c4fcb identified missing cross-organization draft and master coverage, plus duplicated frontend/backend leaf contract. Cross-organization draft coverage now verifies a populated draft through a real authenticated client: readable while membership exists, hidden after membership removal, RPC update denied, forged cross-organization insert denied. Master parity and contract duplication remain review follow-ups.
- Spec review identified actor-independent UI caches/results, empty equality producing a commercial No, master authorization parity, and still-unwired separate draft persistence. Identity is now part of lead/grant query keys and result fingerprints; sidebar remounts personal state on actor/org changes. Browser scenario proves the second actor cannot retain the first actor's selected lead or result.
- Empty equality was reproduced red through the public evaluator, then rejected as invalid_configuration. Browser test also reproduced an enabled test button with missing comparison; UI now disables evaluation, associates an inline accessible error, and explains the explicit is_empty alternative. Whitespace is preserved; this change rejects an absent string, not a deliberately supplied text value.
- Verification: 13 evaluator/API/execution tests passed; all 11 browser cases passed; six real preview integration cases passed. Draft cross-org fixture initially failed because its synthetic org had no user quota; fixture quota corrected, no product permission bypass added. Frontend typecheck ratchet passed with zero introduced errors (805 baseline + 11 inherited tolerated). Focused lint passed after removing throw from finally in fixture cleanup.
- No new migration in this batch. Four existing migrations and corresponding rehearsed rollbacks remain unchanged. No ticket certified complete; publication, version pinning and remaining domain slices still required before final HITL.

## 2026-09-08 — full master parity verified

- Live public-API test reproduced full master receiving access_denied when approving organization data. Added migration 20271017000004 with scoped can_administer_guided_workflow helper shared by grant/draft RLS and write RPCs. Existing org-admin/gestor helper remains unchanged. Full master requires active row and JSON boolean permissions.all=true, not a truthy string or outbound_only role.
- Same authenticated master session now approves, saves and reads; changing it to outbound-only, string-all or inactive immediately denies grant/draft writes and hides their rows. Seven live integration cases pass including this matrix and existing member/cross-org cases.
- Migration applied and registered only in preview mkpjjtwjyvgabavnxqgp. New helper effective grants verified live: anon=false, authenticated=true, service_role=false. Five-migration rollback/reapply rehearsal passed, preserving grant revision 7 and draft revision 11 and restoring exact grant-function definition. Reverse SQL and runbook updated.
- Empty-comparison endpoint deployed to preview successfully with installed Supabase CLI. An earlier npx CLI attempt terminated with LegacyPlatformAuthRequiredError; it made no deployment. Installed CLI reused configured authentication successfully. Deno endpoint check and focused ESLint passed. All deployment/test/rehearsal handles terminal.
- Next: integrate separate draft load/save into actual editor and implement immutable authorized publication before enabling any automatic guided execution. Remaining review smell: duplicated leaf contract. All 21 tickets remain required; none certified complete.
