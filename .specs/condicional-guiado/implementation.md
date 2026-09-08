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

## 2026-09-08 — existing-workflow draft editor seam

- Red browser test reproduced editor loading workflows.definition instead of an existing separate draft. Added actor/org/workflow-scoped draft query; initialization waits for the read and uses its definition. Failed reads present retry instead of silently falling back to the live definition. Empty node arrays remain empty rather than inventing a trigger.
- Red browser test reproduced ordinary workflow save for a guided draft. Existing workflows with guided configuration or an existing draft now save through save_guided_workflow_draft with the loaded revision, update local revision after success, and leave workflows untouched. Incomplete comparison persists as a draft. Save button includes draft mutation pending state.
- Red conflict browser test reproduced raw draft_revision_conflict. Conflict now explains concurrent edit and preserves local values without auto-retry or adopting someone else's revision. Resolving/merging that conflict still needs a complete UI in the publication/editor slice.
- Verification: all 14 browser cases passed; new hook ESLint and git diff --check passed; frontend typecheck ratchet passed with zero introduced errors. No database changes this batch, so existing five-migration rollback evidence remains applicable. Browser cases substitute only external transport; real RPC concurrency/permissions were verified in the prior seven-case integration run.
- Remaining ticket-03 work is explicit: new workflow must be created atomically as an inactive shell plus separate draft; name/enrollment/re-enrollment edits need separate draft persistence; editing a published active workflow must not be blocked by draft validation; immutable authorized publication and conflict recovery remain absent. Current new-workflow path is still legacy create and current automatic guided execution stays closed. Do not certify ticket 03 from these narrower checks.
- Follow-up robustness: draft cache must refresh coherently on save/reopen without adopting a newer remote revision for unsaved local edits; reset editor initialization across actor/org/workflow identity changes; validate stored draft shape before rendering. These are required before final editor certification.

## 2026-09-08 — atomic guided creation

- Public RPC test first failed with missing create_guided_workflow_draft. Migration 20271017000005 adds authenticated, current-admin-authorized atomic creation of an inactive workflow shell (empty live definition, manual trigger) and separate revision-1 draft. It never creates a data grant. Selected organization is checked server-side; UUID and draft/name inputs validated.
- Live integration verifies shell/draft/no-grant behavior, duplicate ID refusal without overwriting the existing draft, cross-org creation denied, and invalid draft leaving no shell. Eight live cases passed. Creation ID is generated once per editor instance so retries cannot silently create a second workflow under a different ID.
- Browser red confirmed new guided creation still used ordinary workflow persistence. Editor now calls the dedicated RPC and navigates to the created workflow. Legacy creation remains its existing path. Browser new-create test verifies RPC payload and absence of direct workflow POST.
- Guided draft loaded without a trigger was rejected by the legacy save guard. Red/green browser scenario now permits this incomplete draft to save; legacy trigger requirement remains. Publication/execution remain closed. An attempted trigger-deletion fixture could not reach its sidebar action; the definitive save test loads an incomplete draft through external persistence, matching the database-supported state. Trigger-panel integration still belongs to complete editor QA.
- Sixth migration applied/registered only on mkpjjtwjyvgabavnxqgp. Effective EXECUTE verified: anon=false, authenticated=true, service_role=false. Six-file reverse rollback and forward reapply rehearsal passed, preserving draft/grant records and restoring permissions. Rollback/runbook included; no production changes.
- Checks: eight live integration cases and final combined 16-browser suite passed. Focused ESLint and diff check passed. Typecheck ratchet for creation changes passed with no new errors, before the final optional-trigger guard edit. All process handles from this batch are terminal.
- Next ticket-03 steps: persist draft name/enrollment/settings under the same revision, coherent cache/reopen and identity reset, active published workflow editing, immutable authorized publication. No ticket certified complete. All 21 tickets and final HITL gate retained.

## 2026-09-08 — draft settings and active workflow editing

- Red real-API tests reproduced missing settings persistence on save and creation. Migrations 20271017000006/07 add nullable draft settings and additive *_with_settings RPCs. They reuse existing authenticated/current administration and parent-row locking, so definition/settings share one transaction and revision. Existing RPC signatures remain available and preserve settings when saving only rules. No data backfill or live-settings update.
- Settings include draft name, preserved legacy enrollment JSON and re-enrollment fields. Legacy enrollment remains unexposed in the UI: repository states it was never evaluated. This change preserves it, not a promise of new enrollment behavior.
- Browser red/green verifies loading draft name/re-enrollment values, saving them with rules, and initial creation using settings in the same RPC. Existing draft fixtures with no settings continue using workflow metadata. Active-workflow draft save now leaves live definition/status untouched and no longer forces deactivation merely because draft configuration is incomplete. Attempted initial activation remains blocked pending authorized publication.
- Live tests verify revision-conflict preservation of both rules/settings, invalid settings rejected, and cross-org create/update denied. New wrappers also receive explicit member denial coverage. Grants for both new signatures verified live: anon=false, authenticated=true, service_role=false. Applied and registered only on preview mkpjjtwjyvgabavnxqgp.
- Eight-migration reverse rollback/forward reapply rehearsal passed with a synthetic settings payload, draft revision 11 and grant revision 7 preserved. Reverse files keep settings column/data intact. Runbook updated.
- Verification: full 18-case browser suite and final 10-case live integration suite (including member assertions) passed. Focused ESLint/diff check passed. Typecheck ratchet passed for settings integration with zero introduced errors, before final active-save predicate edit. All process handles from this batch are terminal.
- Remaining ticket-03 gates: coherent save/reopen cache and identity initialization, untrusted draft shape handling, actionable conflict recovery, immutable authorized publication. Complete history/pinned execution remain subsequent tickets. No ticket certified complete; final HITL still depends on all 21.

## 2026-09-08 — editor navigation and fresh draft initialization

- Browser red reproduced switching automation IDs while retaining the previous local nodes/name/revision. Editor content now remounts at actor/org/workflow identity boundaries. Real MemoryRouter navigation test proves B loads B's nodes, clears A's selection, and saves with B's ID and revision 9.
- Reopening a cached automation reproduced using stale metadata even after a newer draft response arrived. Draft read now refetches on every mount; editor waits for that read to settle before initializing local edits. Subsequent background refresh does not adopt a newer revision into an already edited local draft. Controlled external-response browser test proves latest metadata wins on reopening.
- The loading gate exposed a missing-workflow state; public null response now shows unavailable/no-access with return action rather than endless spinner or a saveable blank editor. Separate read-error test reproduced missing retry; errors now show retry and can recover through the actual query boundary.
- Verification: final combined 22-case browser suite passed. Typecheck ratchet for identity/fresh-read changes passed with zero introduced errors before final unavailable/retry UI additions. Focused hook lint and diff check passed. No migration changes; eight-migration rollback remains intact. All process handles from this batch are terminal.
- Remaining review/security validation: exercise actual editor auth-account change (standalone personal panel already has coverage); existing general useWorkflow cache key is organization/id rather than actor and should be checked for stale metadata reuse at that boundary. Do not treat the remount key alone as proof of full authorization-cache safety.
- Next: untrusted draft rendering guard and actionable conflict comparison/reload, then immutable authorized publication. Current publication and runtime remain closed; no ticket certified complete. Twenty-one browser tests are not twenty-one completed tickets.

## 2026-09-08 — immutable publication foundation, real HTTP and rollback

- Continued ticket 03. Added append-only version snapshots and a selected-version pointer. Service-only finalizer locks the parent workflow, verifies exact persisted revision/definition/settings, rechecks current actor administration and current organizational field grant, then inserts snapshot and changes pointer atomically. Direct writes by authenticated/service clients are denied. Existing live workflow definition/status remain unchanged; runtime gate still closed pending ticket 04.
- Real database integration red (missing finalizer) then green proves version history preserved after later publication, stale revision denied, user invocation denied, missing/revoked grant denied, direct version updates denied, and active pointer preserved after rejected attempts.
- HTTP publication reads the persisted draft with caller JWT, derives verified actor and field scope, rejects incomplete conditions and invalid yes/no connections, and validates graph integrity with the existing validator. Caller-supplied replacement definition/settings/actor/scope are ignored. TDD added a blank persisted name case: 503 red -> localized 422 green before finalization.
- Added publish-guided-workflow Edge entrypoint with explicit requireAuth and error boundary. Real authenticated HTTP test: missing endpoint 404 red -> deployed preview -> 200 green; selected version and original snapshot/actor verified through caller-readable API. Preview only: mkpjjtwjyvgabavnxqgp.
- Migration 20271017000008 applied and registered. Expanded actual reverse rollback/forward reapply rehearsal from eight to nine migrations: preserves synthetic draft, grant, immutable version and selected version; disables table access and finalizer, restores restricted EXECUTE and denies direct version/pointer writes. Outer transaction rolls rehearsal back. Rehearsal passed.
- Checks: 12 live Auth/RLS/HTTP integration tests passed; 3 publication HTTP unit tests passed; Deno check and focused ESLint/diff check passed. All associated command sessions terminal. No production changes.
- Still incomplete: full publication validation for all supported node/action/trigger settings and references; additional HTTP negative/concurrency coverage; publication UI; reader-permission protection (ticket 16); runtime version pinning (04). Ticket 03 is not certified. All 21 tickets and final integrated HITL remain the objective.

## 2026-09-08 — publication vocabulary validation

- Public HTTP red/green cases now reject unknown node, trigger and action types with node-localized issues. Reused the existing executor vocabulary sets guarded by repository parity tests; no new independent type catalog.
- Expanded real HTTP publication scenario: save an invalid successor containing an unknown node, try publication, inspect selected version unchanged. Before deploying the change, real endpoint returned 200 (red); after preview deployment it returns 422 and preserves original pointer (green).
- Added characterization coverage for current non-administrator denial before draft data is read. Existing authorization already passed; no implementation change was needed for that case.
- Checks: 7 HTTP unit cases passed; 12 real Auth/RLS/HTTP integration cases passed; Deno entrypoint check and focused lint passed. No migration changes. All process handles terminal.
- Next: complete supported-node configuration/reference validation and publication editor integration. Known vocabulary alone is not full validity. No ticket certified; all 21 remain in scope.

## 2026-09-08 — shared action requirements on publication

- TDD public HTTP case for known send_whatsapp_audio missing audioUrl failed (503 instead of localized 422); publication now applies existing pure findNodeConfigIssues to action nodes. The guided-condition legacy activation gate is not reused for publication. No copied action-requirement catalog.
- Reused src/contracts/workflows/node-requirements.ts via explicit relative import. Its local mode import now has a .ts extension (supported by frontend tsconfig and required by Deno). Deno check passed; installed Supabase CLI bundled both pure contract files and deployed successfully to preview. No frontend component/context imports enter the Edge bundle.
- Positive configured-audio publication and existing end path pass. Shared editor requirement regression suite passes. Real HTTP scenario saves an incomplete audio successor, receives localized 422, and confirms selected publication unchanged.
- Checks: 33 unit cases across publication and existing node-requirement seam passed; 12 real Auth/RLS/HTTP cases passed; Deno and focused ESLint passed. No migration changes. All associated sessions terminal.
- Limits: existing requirement catalog covers known mandatory fields, not all action semantics/reference validity. Continue full node/settings/reference validation and editor publication integration. No ticket certified, full 21-ticket objective retained.

## 2026-09-08 — editor publication path

- Browser TDD: missing Publicar button red -> editor saves current draft, takes returned revision and invokes authenticated publication using only workflow/org/revision -> success version shown. Existing workflow with a saved guided draft exposes publication; new drafts first use creation/navigation.
- Browser TDD: rejected publication previously showed only generic toast -> parses structured HTTP issues, renders persistent alert with node links, preserves current comparison and re-enables retry. Server access-denied/revision-conflict codes have explicit guidance. Save conflict stops the chain before any publication request and preserves local edits.
- Save/Publish controls are disabled while the relevant persistence request is pending. Publication does not toggle workflow activation. Runtime still awaits version pinning; this UI path publishes version snapshots only.
- Checks: all 25 browser cases passed (external transport harness, not proof of real DB publication); focused lint has zero errors and existing any warnings; diff check passed. Real Auth/RLS/HTTP publication was verified in preceding checkpoints. No migrations in this change.
- Incomplete: complete config/reference validation, robust malformed draft loading, actionable conflict comparison, publication status after reload, and full real-browser preview journey. No ticket certified. Full 21-ticket goal remains active.
- Typecheck ratchet completed: zero new errors; tolerated repository debt 805 baseline plus 11 inherited (481 current occurrences). All test/check handles terminal.

## 2026-09-08 — delay validity and execution version capture

- Publication TDD: zero/negative/non-numeric delay, unknown unit, inverted/incomplete random range, and non-boolean randomized flag produced failures before validation. Added positive finite numeric duration, supported unit and ordered random endpoints checks; fixed and random valid examples publish successfully. 18 public HTTP unit cases passed. Preview publication endpoint updated; Deno and focused lint passed.
- Started ticket 04's admission boundary while ticket 03 still has outstanding validation/UI work. Real integration red showed missing guided_version_id. Migration 20271017000009 adds nullable version FK and a BEFORE INSERT trigger on workflow_executions, so SQL and Edge producers share one capture point. Current publication selected under the same parent workflow lock used by publication; input-supplied pin does not choose rules. Composite FK matches workflow/org/version. Update trigger denies repinning and tenant/workflow changes on pinned executions.
- No historical backfill: older rows remain unversioned. Capture is insertion time, not worker claim time. Runtime consumption/resume is NOT implemented or enabled by this migration. Live workflow remains inactive and existing guided runtime gate remains closed.
- Real integration proved first execution retains version 1 after version 2 publication, later execution captures version 2, and repinning returns access denied. Extended coverage also checks supplied stale pin is ignored and foreign-org enqueue denied. These are API/database checks, not full producer/runtime certification.
- Migration 09 applied and registered on preview only. Rollback disables INSERT capture but retains UPDATE immutability guard, column/FK/index and all pins. Operators must stop new guided admission before rollback and retain version-aware execution support for pinned runs until drained. Ten-migration reverse rollback/reapply rehearsal passed, preserving grants, drafts, versions, selected pointer and synthetic execution pin. Effective direct EXECUTE for pin trigger is false for anon/authenticated/service_role.
- Outstanding ticket 04: actual producer-path/concurrency coverage, executor loading pinned definitions/settings, yes/no routing, resume with current data, no repeated actions, revocation and legacy regressions. No ticket certified; full 21-ticket scope retained.
- Final checks: 12 real integration cases passed including stale supplied pin and cross-org rejection; focused lint/diff checks passed. All command sessions terminal.

## 2026-09-08 — executor snapshot and authorized guided decision

- TDD public executor seam: current workflow removed an old wait, yielding completed (red); optional guidedVersionId now verifies the execution's persisted pin under execution/workflow/org filters and loads that exact version under version/workflow/org filters. The old two-hour wait pauses correctly (green). Unavailable version fails without falling back to current graph or writing decision steps.
- Pinned condition initially failed at the draft gate (red). Verified pinned execution now prevalidates guided leaf and exactly one yes/no output for every condition before traversal, evaluates current data using the existing current-grant read RPC, and selects the explicit handle. Unpinned guided drafts remain rejected. Access failure terminates without selecting a business branch. Recorded guided result includes boolean and version ID, not raw lead name; history authorization remains ticket 16.
- Version settings supply loop_limit when present, otherwise the existing default 100. Current workflow loop limit is not used for pinned execution. Full settings snapshot validation/persistence still needs completion.
- Checks: 69 executor/branch regression cases passed before adding two additional outcome variants; final guided executor suite has 6 passing cases (yes/no/revoked included). Deno executor check passed; focused lint has zero errors and four existing any warnings.
- Real preview integration: after pinning first version and publishing a successor, changed the synthetic lead name from José to Mariana. Public executeWorkflow loaded first snapshot despite empty supplied current graph, consulted current authorized data, completed through node n, and recorded only t/c/n. Fixture name restored. Full 12-case real integration suite passed; no new migration or runtime deployment.
- Still missing: worker passes the claimed pin and uses version trigger/settings for prechecks; real pause/resume with rule publication and actions counted once; producer/concurrency end-to-end coverage; remaining publication validation and all later tickets. Worker remains unwired to this new parameter at this checkpoint. No ticket certified. All 21 tickets remain the objective.
- Follow-up: lint flagged throwing from the fixture restoration finally block (could mask original failure). Moved restoration assertion outside finally. Focused integration lint and rerun of all 12 real cases passed. All associated sessions terminal.

## 2026-09-08 — worker version routing and real pause/resume

- Public worker HTTP TDD: a claimed execution carried version v1 but current workflow changed its tag filter. Worker skipped execution against current trigger (red). Worker now scopes workflow lookup by organization, retains current active/plan checks, loads claimed publication and uses its trigger config/name/loop limit, then passes guidedVersionId to executor. Missing publication fails without using current rules. HTTP test imports actual Edge entrypoint and captures Deno.serve; only external database transport is substituted.
- Deno check initially exposed generic ReturnType<typeof createClient> incompatibility (53 errors across worker). Used the exported SupabaseClient type on four worker helpers; remaining pre-existing .catch on a thenable RPC was changed to Promise.resolve(...).catch, preserving intended fallback and allowing Deno check to pass. No schema/generated type or baseline edits.
- Added real pause/resume test: first publication creates one follow-up task, waits two hours, persists resume node c and counters. During wait, publishes new condition expecting Mariana and changes synthetic lead from José to Mariana. Resuming existing pin uses original José rule, selects no, finishes, and leaves exactly one real follow-up and one step per action/wait/condition/end. Fixture restores name; cleanup explicitly deletes synthetic follow_ups before leads.
- Checks: 73 unit cases across worker, guided executor and legacy executor/branches passed. Real preview suite now 13 passing cases. Worker Deno check and focused lint passed (one existing any warning). All command sessions terminal. No migration change or worker deployment in this checkpoint.
- Still needed before ticket 04 certification: publish trigger/settings metadata consumed by enqueue discovery, guided activation flow, authoritative all-producer/concurrency validation, actual deployed-worker/claim/resume integration and revocation during pause. Existing pin trigger covers insertion mechanically; that alone does not prove discovery uses published configuration. Full publication config/reference validity and history read authorization remain incomplete. No ticket certified; all 21 tickets remain the objective.

## 2026-09-08 — published trigger discovery and revoked resume

- Real HTTP publication test expected lead_created discovery metadata but observed manual (red). Migration 20271017000010 adds a trigger on selected publication that loads the same workflow/org/version and synchronizes workflows.name/trigger_type/trigger_config in the finalizer transaction. It requires one trigger with string type and object config. It does not activate the workflow, backfill existing rows or replace legacy definition. Integration green verifies metadata and inactive state.
- Applied and registered only on preview. New trigger function is SECURITY DEFINER with fixed search_path, no direct EXECUTE to PUBLIC/anon/authenticated/service_role. Rollback removes sync trigger/function and preserves current published metadata, versions and execution pins; admission must stop first. Eleven-migration rollback/reapply rehearsal passed with a valid synthetic trigger snapshot, metadata preservation and effective function grants checked live.
- Expanded real pause/resume test with revocation during the wait. Current grant is revoked after successor publication. Resume of old pinned execution terminates access_denied, records no yes/no end branch, and leaves its earlier follow-up task exactly once. Existing non-revoked scenario still uses old rule and current lead data.
- Final checks: 14 real Auth/RLS/HTTP/executor integration cases passed; focused lint and diff check passed. All command sessions terminal. No worker deployment or activation in this checkpoint.
- Outstanding: protect/validate the full published discovery surface, consumers that inspect workflow.definition (not only trigger metadata), enrollment/settings snapshot, activation RPC/UI, producer/publication concurrency and real deployed-worker journey. Current metadata sync alone does not certify all producer paths. No ticket certified; all 21-ticket scope retained.

## 2026-09-08 — authorized activation API and editor

- Real RPC TDD red: missing set_guided_workflow_active. Migration 20271017000011 adds authenticated administrator activation/deactivation using workflow-derived organization and parent-row lock. Activation requires the caller's expected selected version (PT409 on change). A BEFORE UPDATE OF is_active guard also requires publication, current administrator, unblocked organization and current required-field grant for direct API updates. Deactivation does not require a current data grant.
- Positive/negative real checks: activate selected version, reject stale version, deactivate, reject unpublished activation via RPC/direct update, revoke data grant then reject activation via both paths. Fourteen real integration cases passed.
- Rollback drops activation RPC and replaces retained guard with fail-closed guided activation, preserving existing state and allowing deactivation. Twelve-migration reverse rollback/reapply rehearsal passed, including an attempted activation after rollback and live effective function-grant checks. Applied/registered only on preview; no historical update/backfill.
- Browser TDD red: switch only changed local state. Editor now queries selected version with actor/org/workflow key and uses activation RPC for published guided drafts. Publication success updates selected-version cache. Switch waits for publication read and activation request. Server rejection keeps current state. New/unpublished draft path retains existing draft activation warning pending UX refinement.
- Checks: 26 browser tests passed; 14 real API/Auth/RLS tests passed; focused lint has zero errors and existing any warnings; diff check passed. Worker remains undeployed.
- Outstanding: UI recovery when publication lookup fails (including deactivation access), stale-version refresh feedback, active-state cache coherence, remaining producer/discovery graph consumers, complete config/reference validation, and real deployed-worker journey. No ticket certified; all 21 tickets remain in scope.
- Typecheck ratchet completed with zero introduced errors (805 baseline plus 11 inherited tolerated). All associated process handles terminal.

## 2026-09-08 — activation lookup recovery

- Browser TDD reproduced disabled deactivation when publication lookup failed. Active guided workflows now call deactivation RPC even without a readable publication; inactive activation remains blocked until lookup succeeds. This uses the API's existing deactivation-without-current-grant contract.
- Browser TDD reproduced missing lookup recovery UI. Added persistent publication-read error and explicit refetch button. Recovery restores activation availability without replacing unsaved condition edits.
- All 28 browser cases passed. Focused lint passed with existing any warnings; diff check passed. No database changes, worker deployment or additional typecheck baseline changes. All process sessions terminal.
- Outstanding certification and later-ticket scope unchanged. Next substantial product slice is grouped All/Any rules (ticket 05), while producer/runtime end-to-end validation for 03/04 remains open. No ticket certified and no final HITL yet.

## 2026-09-08 — grouped evaluation and first editor path

- Ticket 05 in progress. Public evaluator accepts All/Any trees, validates the whole shape with unique rule/group IDs and at most three group levels, and derives deduplicated publication fields from leaves. Short-circuited leaves/groups explicitly report not_evaluated. Existing single-leaf response remains compatible.
- First browser slice now creates two rules, selects Qualquer, sends the full tree and displays skipped rules. Depth test reproduced creation of a fourth group; editor now disables nested conversion at depth three while retaining new sibling rules and focus on the added value.
- Additional public-service red reproduced a leaf carrying children being interpreted as a group after validation. Validator now rejects leaf/group discriminator ambiguity before a personal data read; green verifies invalid_configuration and zero transport reads.
- Verification: 30 browser cases passed (external transport substituted), 37 evaluator/publication/executor unit cases passed, Deno checks for evaluator/publication passed, focused ESLint zero errors (one Fast Refresh mixed-export warning in the builder), diff check passed. No migration or deployment in this checkpoint. Frontend typecheck ratchet still being observed separately.
- Remaining ticket 05: duplication/removal/collapse, hierarchical results and canvas summary, panel sizing, keyboard journey, real grouped HTTP/publication/execution proof. This checkpoint does not certify ticket 05 or any of the 21 tickets. All original scope, rollback requirements and final HITL gate retained.
- Typecheck ratchet finished: zero introduced errors; 805 baseline plus 11 inherited tolerated, 481 current occurrences. All associated process handles terminal.

## 2026-09-08 — group editing operations

- Browser TDD red→green: duplicating a nested group inserts an independent sibling with fresh IDs throughout its subtree. Public test-request payload proves preserved source values, independently edited copy and seven distinct descendant identities.
- Browser TDD red→green: removing rules preserves remaining values and moves focus to the parent's combination selector. Empty groups remain editable, show an explicit empty-state error, and cannot be tested. Keyboard Enter adds a replacement rule and focuses its input. The same removal operation is exposed for nested groups.
- Browser TDD red→green: collapse/expand works with Enter, retains toggle focus and comparison values, and shows a parenthesized All/Any summary while collapsed. This is the panel summary only; canvas integration and hierarchical test results remain pending.
- Focused lint: zero errors, existing builder Fast Refresh mixed-export warning. No database changes or deployments. Full editor browser regression running for this checkpoint; no ticket certified and no final HITL.
- Full browser regression completed: 33 passed. All process sessions terminal. Ticket 05 still needs canvas/hierarchical result summaries, panel sizing, real grouped service/publication/execution validation and complete keyboard/structural coverage.

## 2026-09-08 — canvas and hierarchical results

- Browser TDD red→green: canvas now derives its guided summary from the current draft tree, sharing the panel's parenthesized All/Any semantics. Native title retains the full summary when the canvas line truncates.
- Browser TDD red→green: test results render groups and numbered descendant rules under their actual parent. IDs, not response order, associate outcomes. Missing outcomes display Resultado indisponível; skipped branches display Não avaliada. Existing single-rule explanation remains.
- Full editor regression: 35 browser cases passed. Focused lint has zero errors and the existing builder Fast Refresh warning; diff check passed.
- Real preview HTTP test red: grouped personal evaluation returned invalid_configuration from the previous deployed endpoint. Deployed only test-guided-condition to healthy non-default preview mkpjjtwjyvgabavnxqgp. Green: 15 real Auth/RLS/HTTP/executor cases passed, including grouped skip explanation and rejection of a foreign lead with no values exposed. No migration or production deployment.
- Follow-up grouped publication scenario now being verified against the deployed publication endpoint. Typecheck ratchet still running. Ticket 05 and the complete 21-ticket objective remain open.
- Grouped publication red returned HTTP 422 on the previous deployment. Deployed publish-guided-workflow to the same preview. Green: all 16 real integration cases passed, including both leaf/group immutable publication, current grant activation and preservation on invalid successor publication. Worker remains undeployed.
- Typecheck ratchet completed with zero introduced errors (805 baseline + 11 inherited tolerated; 481 current occurrences). Integration lint and diff check passed. All process handles terminal.
- No new migrations. Existing rollback chain remains unchanged. Remaining ticket 05: panel sizing, broader keyboard/structural cases, invalid-reference handling across future field domains and grouped execution coverage; ticket 03/04 producer/runtime gaps and tickets 06–21 remain in scope. No ticket certified complete.

## 2026-09-08 — expandable panel and grouped resume

- Browser TDD red→green: guided sidebar now offers keyboard-accessible expand/reduce controls (360/640px, capped by available width). It preserves edits and toggle focus, remains within a 600px viewport, exposes a named complementary landmark and names its close control.
- Extended the existing real executor regression across leaf/group × active/revoked grant. After an earlier follow-up action and wait, a successor publication replaces the original group with different rules, and lead data changes. Resume still uses the pinned original group against current data, takes No when appropriate, and rejects revoked access without repeating the follow-up. All 18 real Auth/RLS/HTTP/executor cases passed.
- Focused lint: zero errors, existing sidebar any warnings. No migration, deployment or rollback-chain changes in this checkpoint. Browser full regression is being finalized.
- Ticket 05's core name-only grouped behavior is now exercised through browser, HTTP publication/test and real executor integration. Broader field/reference domains, full product design review and final certification remain pending. Tickets 03/04 producer/runtime gaps and 06–21 remain in full scope; no ticket closed.
- Full browser regression exposed intermittent focus theft in collapse-by-keyboard: delayed requestAnimationFrame for a newly added rule could override later focus. Replaced delayed callbacks with a pending focus target consumed in useLayoutEffect after the tree update. Targeted collapse replay passed before the fix (confirming intermittence); the failing full run remains evidence of the race. Full regression rerunning after the correction; no assertion or timeout weakened.
- Final full browser run passed all 36 cases after focus correction. Focused lint and diff check passed with existing warnings only. All process handles terminal. Next domain slice: standard lead fields/catalogs (ticket 06), preserving explicit per-field organizational grants and rollback coverage for any schema expansion.

## 2026-09-08 — company scalar field, personal evaluation path

- Ticket 06 started with Empresa as the next concrete scalar. Added an explicit shared field catalogue for Nome/Empresa, used by frontend types/selectors/summaries and the Deno evaluator. It does not advertise unimplemented columns.
- Public evaluator TDD red→green: a mixed Nome/Empresa group reads only requested columns, compares each field independently with case/accent normalization and preserves actual text in its explanation. Existing leaf/group/executor/publication unit cases remain green (38 tests).
- Browser TDD red→green: Informação selects Empresa, retains compatible text/operator choices, uses the correct actual-value label, and preserves is_empty when returning to Nome. Full browser regression: 37 passed. Deno evaluator/publication checks and focused lint passed (existing Fast Refresh warning only).
- Real personal HTTP red reproduced invalid_configuration on the previous deployed endpoint. Deployed test-guided-condition only to preview mkpjjtwjyvgabavnxqgp; real integration green is being verified.
- Deliberately unfinished organizational path: existing SQL grant constraint, grant RPC, finalizer allowlist and reader support name only. Additional-field organizational evaluation explicitly denies access until an additive, rollback-tested field-scoped reader and approval expansion are installed. No broad service-role fallback, implicit grant or company publication is enabled. This is an intermediate checkpoint, not completion of ticket 06 or any of the 21 tickets.
- No migrations in this checkpoint. Next work must complete Empresa authorization/publication/automatic evaluation before expanding further scalar/catalog capabilities. Typecheck and preview integration still running.
- Final verification: 19 real preview integration cases passed, including personal company evaluation with stored company text. Typecheck ratchet passed with zero introduced errors (805 baseline + 11 inherited tolerated, 481 current occurrences). All process handles terminal. No new migration or publication/worker deployment.

## 2026-09-08 — company organization authorization

- Real RPC TDD red: field-scoped reader absent. Migration 20271017000012 adds explicit name/company grant scope, extends authorized finalizer allowlist and introduces service-only read_guided_condition_lead_fields. It checks the complete requested field set against the current workflow grant under SHARE locks and returns only requested values. Company-only approval does not expose name. No prior approval changes or data backfill.
- Initial apply failed at parse time on reserved output identifier values; transaction did not apply. Corrected to field_values before successful apply. Migration is now immutable, applied/registered on preview only.
- Real tests cover name approval insufficient for company, explicit company approval, exact field projection, authenticated reader denial, foreign org/lead manipulation, unsupported fields and revocation. Evaluator TDD red then green connects mixed/company requests to this reader; name-only requests retain their existing RPC. Missing projected values are source_unavailable rather than empty.
- Rollback restores name-only writer/finalizer, disables the new reader and preserves approval/version/execution history. Thirteen-file reverse rollback/reapply rehearsal passed with synthetic name+company history and effective grant checks. Live reader EXECUTE: anon false, authenticated false, service true.
- Browser TDD red→green: current condition's fields determine displayed approval scope. Adding company preserves existing name approval; revoking company preserves name. Grant writes still use expected revision. Full regression underway.
- Real publication scenario initially returned 422 from old deployment. Updated publish-guided-workflow on preview only. Real follow-up now checks company publication and pinned executor's explicit Yes branch. Worker remains undeployed; no production release or ticket certification.
- Unit suite: 38 passed; Deno evaluator/publication checks passed; focused lint zero errors with existing sidebar any warnings. Typecheck and final integration/browser outcomes pending.
- Final outcomes: 38 browser cases and 20 real integration cases passed, including company publication and Yes branch execution. Typecheck ratchet zero introduced errors (805 baseline + 11 inherited tolerated; 481 current occurrences). Diff check passed; all process handles terminal. Remaining ticket 06 includes additional scalar operators/fields, tags, responsible/origin/UTM catalog semantics and tests. All 21-ticket scope retained, no final HITL yet.

## 2026-09-08 — scalar text operators

- Public evaluator TDD red→green adds not_equals, contains, not_contains, starts_with and ends_with alongside equals/is_empty. Text normalization remains case/accent insensitive, originals preserved. Missing text never satisfies negative comparisons. Public matrix covers matching/nonmatching pairs and null/empty negatives; 50 evaluator/executor/publication unit tests passed.
- Shared valued-operator contract drives validation, draft typing, selector labels and summaries. Browser TDD red→green verifies operator changes preserve compatible text, canvas labels follow selected semantics, is_empty removes the value and returning to a valued operator requires new input. Full editor browser suite: 39 passed.
- Deno checks and focused lint passed (existing Fast Refresh warning only), diff check passed. No migration or grant expansion: operators use the same explicitly approved fields.
- Real HTTP tests reproduced 422 for contains on both old personal/publication endpoints. Updated both only on preview mkpjjtwjyvgabavnxqgp. Final real integration verifies substring company test/publication and the pinned executor's Yes branch; result pending together with Typecheck ratchet. Worker remains undeployed. No ticket certified and no final HITL.
- Final outcomes: 20 real integration tests passed after deployment. Typecheck ratchet zero introduced errors (805 baseline + 11 inherited tolerated, 481 current occurrences). All process handles terminal. Remaining ticket 06: additional scalar fields/types and tags/responsible/origin/UTM catalog paths with exact identity and access semantics; broader 21-ticket scope remains unchanged.

## 2026-09-08 — email and phone scalar paths

- Public evaluator and browser TDD red→green add Email/Telefone to the explicit shared scalar catalogue. Operators remain textual; actual stored values are preserved, and requested projections do not include unrelated fields. 51 unit cases passed; focused Email/Telefone browser cases passed.
- Real grant matrix initially failed because contact scopes were unsupported. Migration 20271017000013 expands exact field allowlists/projection without implicit approval changes, and is applied/registered only on preview. Effective EXECUTE permissions verified live.
- Fourteen-migration reverse rollback and superset recovery rehearsed with four-field synthetic approval/version history. Recovery skips replaying narrower 12 because 13 includes its definitions; documented in grants-and-rollback. Migration 13 rollback retains data and restores name/company-only readers/writers/finalizer. No legacy migration edited.
- Real HTTP then failed on old endpoint validation for contacts. Updated personal/publication endpoints only on preview. Existing unsupported-scope test now uses lead.password because lead.email is intentionally supported. Personal, approval, publication and executor cases cover company/email/phone with separate grants and foreign-scope rejection; final run pending.
- Full browser suite: 41 passed. Deno checks, focused lint and diff check passed. Typecheck ratchet still running. No production/worker deployment, ticket 06 and the full 21-ticket objective remain open.
- Final validation: 24 real integration cases passed; Typecheck ratchet zero introduced errors (805 baseline + 11 inherited tolerated, 481 current occurrences). No additional code changes after those checks. Remaining ticket 06 still includes richer scalar types and tags/responsible/origin/UTM catalog semantics; no final HITL or ticket certification.

## 2026-09-08 — personal tag identity and membership

- Real RPC TDD red→green: missing personal tag reader now delivered by migration 20271017000014. Stable invoker function validates every referenced tag and lead under caller RLS before returning membership. Existing-but-unassigned returns false; missing/cross-org tag returns reference_unavailable (PT422), inaccessible lead context_unavailable (PT404).
- Evaluator TDD red→green adds UUID-based has_tag/not_has_tag rules. Tag references are validated before any comparisons, so an invalid tag in a dispensable Any branch produces an error instead of a fabricated boolean. Results explain current tag identity/name and assignment. Organizational tag evaluation remains explicitly denied until its separate grant/reader path is built.
- No tag selector or automatic tag publication is delivered in this checkpoint yet. This is the personal evaluation portion of ticket 06; remaining UI, organizational scope and all later tickets remain required.
- Applied/registered only on preview. Fifteen-file rollback/recovery rehearsal passed; effective RPC EXECUTE checked live (authenticated only). Deno checks, existing 51 unit cases and focused lint passed. First real evaluator integration green: 25 cases passed. HTTP test and responsible-only RPC negative probes now being verified; endpoint still previous scalar deployment.

- Deployment uncertainty resolved by exercising the live personal endpoint: all 25 integration tests passed. No live deploy process remained, and no duplicate deployment was started for that uncertainty.
- A new public integration probe with uppercase UUID reproduced reference_unavailable for an existing assigned tag. Canonicalized validated UUID lookup keys without changing saved configuration or tag identity. Redeployed personal endpoint only after the code change; Deno checks, 51 unit cases, focused lint and diff check passed. Final real HTTP/RLS integration: 25 passed, including uppercase identity.
- Re-ran the fifteen-migration reverse rollback/superset recovery rehearsal successfully; synthetic approval history preserved. No production or worker deployment. Personal tag UI and organizational tag authorization remain outstanding; no ticket certified and all 21 tickets remain the objective.

## 2026-09-08 — personal tag selector

- Browser TDD red→green: Tags appears in the guided information dropdown, with server-side name search and native keyboard-operable selection by UUID. The public Leads catalogue hook reads only id/name under caller RLS, scopes queries by organization, separates cache by actor, bounds each search page to 25 and reads the selected reference independently of that page. Existing CRUD invalidations still reach these cache entries.
- Draft stores tagLabel only as a display hint; current tag identity/name is resolved by the evaluator. Canvas/group summaries use friendly labels; personal single-rule test displays the server-returned tag name and assigned/not-assigned state. Full tree tag explanation and rename/copy/reference lifecycle remain to certify.
- Changing between tag and scalar types clears incompatible fields and explains the reset inline. Changing has/not-has preserves selected identity. Missing/deleted reference errors from the personal endpoint are explained distinctly and never leave a prior boolean result on screen.
- Catalogue loading, empty search, removed/inaccessible selection and transport error are distinct; retry loads the catalogue without discarding the condition. Organizational tag grant UI is explicitly unavailable until the authorized backend path is delivered; there is no implicit broadening of existing grants.
- First full browser regression: 42 passed. Subsequent removed-reference public UI case reproduced the generic error and now passes alongside access-denied regression. Catalogue-retry case reproduced the missing retry action; final focused verification and typecheck are pending. Typecheck's introduced nullable selected-tag access was corrected. No migration/deploy in this frontend checkpoint. All 21-ticket scope remains active; no ticket certified.
- Final checks: tag selection/reference-error scenario and catalogue retry both passed; access-denied regression passed after error-copy change. Typecheck ratchet zero introduced errors (805 baseline + 11 inherited tolerated; 481 current occurrences). All browser/typecheck handles terminal. Full-suite result remains the earlier 42 passed; the later retry scenario was verified in a focused run, not claimed as a new full-suite run. Remaining work includes authoritative label refresh/lifecycle tests, organizational tag publication/evaluation, other standard fields and all downstream tickets.
