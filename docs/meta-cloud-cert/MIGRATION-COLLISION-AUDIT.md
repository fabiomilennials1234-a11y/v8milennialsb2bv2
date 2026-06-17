I'll synthesize the findings. The data is fully provided in the prompt, so I can produce the remediation plan directly without needing prod access (which I correctly do not have).

# Migration Collision Audit — Remediation Plan

**Heuristic basis:** All "winner/loser" calls are inferred from git add-dates (earlier timestamp = recorded by `supabase db push`, later = silently skipped on shared version number). No prod `schema_migrations` access — every claim below is a hypothesis until verified against prod.

## 1. SEVERITY TABLE

| Version | Loser (missing in prod) | What's missing in prod | Severity | Safe to re-apply |
|---|---|---|---|---|
| 20261012000000 | fix_rls_service_role_and_api_key_auth | `TO service_role` clause on 8 tables' RLS (tenant isolation bypass) + `generate_api_key()` authz check | **critical** | yes (idempotent) |
| 20261016000000 | security_fix_link_agent_org_validation | org ownership check in `link/unlink_agent_to_instance()` (cross-tenant binding via SECURITY DEFINER) | **critical** | yes (idempotent) |
| 20261016000001 | security_fix_remaining_is_team_member_policies | 10+ tables still on permissive `is_team_member()` instead of org-scoped RLS | **critical** | yes (idempotent) |
| 20261128000000 | api_list_leads_rpc | `api_list_leads()` RPC — `GET /api/v1/leads` backend non-functional | **critical** | yes (idempotent) |
| 20261215000000 | fix_whatsapp_purge_reused_number | timestamp guard on purge cron (deletes new msgs on reused numbers — active dataloss) | **critical** | yes (idempotent) |
| 20260603000000 | get_phone_ai_status_master_bypass | master cross-org read of AI phone status (broken shadow-mode audit) | high | yes (idempotent) |
| 20260930000000 | user_write_instance | instance write-binding cols, owner audit, flag, 4 RPCs | high | yes (guarded backfill) |
| 20260985000000 | fix_meetings_created_by_fkey | `meetings.created_by` FK → auth.users + nullable + `get_agenda_events()` fix | high | yes (DROP/ADD + COR) |
| 20261026000000 | admin_reassign_credit_rpcs | 3 admin credit-reassign RPCs (DEV-only, pending prod approval) | high | yes (idempotent) |
| 20261030000000 | lead_history_metadata_default_and_indexes | metadata DEFAULT/NOT NULL + 2 perf indexes on lead_history | high | yes (idempotent) |
| 20261030000001 | onboarding_seed_templates | 3 pipeline + 3 automation seed templates | high | **NO** (bare INSERT) |
| 20261031000008 | fix_checklist_rls_use_helpers | checklist RLS via `get_my_organization_ids()` (recursion fix) | high | yes (idempotent) |
| 20261105000000 | domain_events | domain_events table + RLS (event-bus) | high | yes (idempotent) |
| 20261105000001 | event_dispatcher_cron | `invoke_event_dispatcher()` + 1-min cron | high | yes (needs config seed) |
| 20261121000000 | pipeline_stages_custom_pipe_target | target_pipeline_id/stage_id cols + exclusivity constraint | high | yes (idempotent) |
| 20261125000000 | meeting_events | event-sourced meeting metrics table + triggers + backfill | high | **NO** (unguarded backfill) |
| 20261127000000 | fix_org_delete_fk_cascade_round2 | 4 FK CASCADE fixes (org deletion blocked) | high | yes (idempotent) |
| 20261119000000 | get_stage_lead_ids_rpc | `get_stage_lead_ids()` for Quick Blast audience | medium | yes (idempotent) |
| 20261031000000 | push_subscriptions | push_subscriptions table + RLS | medium | yes (idempotent)* |
| 20261031000004 | feature_leads_reassign | `leads.reassign` feature permission row | medium | yes (idempotent) |

\* push_subscriptions uses bare `CREATE TABLE` (not `IF NOT EXISTS`) per the finding — idempotent only against a clean prod (table confirmed absent); would error if the table was created out-of-band.

## 2. AUTO-FIXABLE NOW (prod-neutral, idempotent → re-timestamp in a PR)

These losers are idempotent (CREATE OR REPLACE / DROP+CREATE policy / ADD COLUMN IF NOT EXISTS / ON CONFLICT / guarded backfill). Re-timestamp each to a unique version (e.g. `+000001`) so the next `db push` applies them cleanly without re-colliding. They will no-op where the winner already produced the object, and patch where it didn't:

- 20260603000000 → get_phone_ai_status_master_bypass
- 20260930000000 → user_write_instance
- 20260985000000 → fix_meetings_created_by_fkey
- 20261012000000 → fix_rls_service_role_and_api_key_auth **(critical — see §4)**
- 20261016000000 → security_fix_link_agent_org_validation **(critical)**
- 20261016000001 → security_fix_remaining_is_team_member_policies **(critical)**
- 20261030000000 → lead_history_metadata_default_and_indexes
- 20261031000004 → feature_leads_reassign
- 20261031000008 → fix_checklist_rls_use_helpers
- 20261105000000 → domain_events
- 20261119000000 → get_stage_lead_ids_rpc
- 20261121000000 → pipeline_stages_custom_pipe_target
- 20261127000000 → fix_org_delete_fk_cascade_round2
- 20261128000000 → api_list_leads_rpc **(critical)**
- 20261215000000 → fix_whatsapp_purge_reused_number **(critical — see §4)**

**Caveat (still no prod access):** "Auto-fixable" means the SQL is *self-protecting* if run, not that it's confirmed-missing. Two entries carry conditional risk:
- **20261105000001 (event_dispatcher_cron):** idempotent SQL, but requires `event_dispatcher_url` + `cron_secret` seeded in `cron_config` first, else the cron drains to a dead endpoint. Stage behind §3 confirmation.
- **20261031000000 (push_subscriptions):** safe only if prod truly lacks the table; harden to `CREATE TABLE IF NOT EXISTS` in the re-timestamped file before pushing.

## 3. NEEDS PROD CONFIRMATION (not idempotent OR uncertain winner/loser call)

Confirm against prod `schema_migrations` and live schema **before** acting:

- **20261030000001 — onboarding_seed_templates (NOT idempotent).** Bare `INSERT` with no `ON CONFLICT`/`WHERE NOT EXISTS`. Re-running duplicates seed rows → doubled onboarding templates. **Fix before reapply:** rewrite as `UPSERT`/`INSERT … ON CONFLICT (name,type) DO NOTHING`, or `DELETE`+`INSERT` guarded. Confirm whether prod already has these templates (maybe seeded out-of-band) before crafting.
- **20261125000000 — meeting_events (NOT idempotent).** Trigger fn is `CREATE OR REPLACE` (safe) but the two backfill `INSERT` blocks have no top-level guard → re-aggregate and double/triple meeting metrics in dashboards. **Fix before reapply:** split into (a) idempotent DDL+trigger now, (b) backfill gated on `WHERE NOT EXISTS` / `TRUNCATE`-then-load against an empty table only. Must confirm prod table state first.
- **20261026000000 — admin_reassign_credit_rpcs (idempotent but policy-gated).** Loser's own header marks it DEV-only, pending explicit prod approval. Idempotent, but **do not auto-ship to prod** — needs CTO sign-off that credit-reassign tooling is wanted in prod (per global rule: prod only on explicit request).
- **20261105000001 — event_dispatcher_cron (config dependency).** Idempotent SQL but cron is inert/harmful without `cron_config` seeds; confirm prerequisites + that `domain_events` (its dependency, 20261105000000) lands first.
- **20261031000000 — push_subscriptions (DDL not guarded).** Confirm table absent in prod before reapply (or harden to `IF NOT EXISTS`).

## 4. CRITICAL CALLOUTS — urgent, likely missing from prod

These are security/dataloss losers whose fix almost certainly **never ran in prod** (winner recorded the shared version):

1. **20261215000000 — fix_whatsapp_purge_reused_number — ACTIVE DATALOSS.** Cross-references a *confirmed incident* (2026-06-12, org Bertin) and the standing MEMORY entry on the purge cron eating reused-number history. The nightly purge at **03:00 UTC** deletes all messages for a number/instance with no timestamp guard. Every night this is unpatched in prod = more silent message loss across all orgs. **Patch first.** (Cross-check: the MEMORY note also flags PITR OFF — combined, dataloss is unrecoverable.)
2. **20261012000000 — fix_rls_service_role_and_api_key_auth — TENANT ISOLATION + API-KEY MINTING.** 8 tables (agent_decision_logs, conversation_summaries, webhook_dead_letters, outbound_dispatch_log, system_alerts, audit_log, workflow_executions, workflow_execution_steps) have service_role policies missing `TO service_role`, plus `generate_api_key()` lets any user mint keys for any org. Direct cross-tenant exposure + privilege escalation.
3. **20261016000000 — security_fix_link_agent_org_validation — CROSS-TENANT BINDING.** SECURITY DEFINER link/unlink functions accept any agent_id/instance_id without org ownership check → Org A user can bind/unbind Org B's agent↔instance.
4. **20261016000001 — security_fix_remaining_is_team_member_policies — MULTI-TABLE CROSS-ORG READ.** 10+ tables (leads, lead_history, commissions, goals, profiles, …) still on `is_team_member()` → any authenticated user from any org reads them. This is the same `is_team_member` over-permissive class that has recurred in this codebase.
5. **20261128000000 — api_list_leads_rpc — (functional-critical, not security).** Public REST `GET /api/v1/leads` is dead without it; lower urgency than the four above but flagged critical because it's an external contract.

**Pattern note:** items 2–4 are all the *security-hardening commits that lost a version collision the same afternoon (2026-05-15)* — a single bad-timestamp batch left three cross-tenant holes open in prod simultaneously. Treat as one coordinated hotfix.

## 5. RECOMMENDED NEXT STEP

1. **Verify before touching anything** (no prod access here): pull prod `schema_migrations` and probe live schema for the specific objects — does `generate_api_key()` have the authz branch? Do the 8 tables' service_role policies carry `TO service_role`? Is the purge cron's delete timestamp-guarded? Does `meeting_events` / `domain_events` / `push_subscriptions` exist? This converts every heuristic call above into a fact and prevents re-applying something already present.
2. **Ship the critical hotfix branch from `main`** (per hotfix rule): re-timestamp the 5 critical losers (§4) to unique versions, hardening none-needed (all 5 are idempotent), PR direct to `main`. Prioritize `fix_whatsapp_purge_reused_number` — it loses data every night at 03:00 UTC.
3. **Second PR (high/medium, idempotent)** from develop: re-timestamp the remaining §2 entries to unique versions; exclude the two §3 config/policy-gated ones (event_dispatcher_cron, admin_reassign_credit_rpcs) pending confirmation.
4. **Third PR (rework required):** rewrite the two non-idempotent losers — `onboarding_seed_templates` (→ UPSERT) and `meeting_events` (→ split DDL/guarded-backfill) — then confirm prod state before applying.
5. **Prevent recurrence:** add a CI guard that fails when two migration files share a version prefix (this collision class has now produced 21 silent skips). This mirrors the existing master-ghost CI-guard pattern in the codebase.

**Honesty note:** every winner/loser determination rests on git add-date ordering as a proxy for `db push` recording order. If any of these versions were ever reconciled out-of-band (the codebase has a documented history of out-of-band prod drift, e.g. `org_get_subscription_status`), the actual prod state may differ. Step 1 is non-negotiable before any prod write.