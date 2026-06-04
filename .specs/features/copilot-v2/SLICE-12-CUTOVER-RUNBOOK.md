# Slice 12 — Cutover & Decommission Runbook (CTO-gated)

> **Scope discipline.** This document is the operational procedure for the
> Copilot v2 cutover. **Everything here is CTO-gated and is NOT executed by the
> implementation PR.** The PR ships code + tests on `develop` only; the prod
> migration apply, the per-org flag flip, and the GEN-1 deletion are manual,
> authorized steps. Nothing in prod or `main` was touched to land Slice 12.

Date assembled: 2026-06-04. Branch: `feat/copilot-v2/slice-12-cutover` (off `develop` `ae13cfb0`).

---

## 0. What the PR delivers (in `develop`)

| Piece | Where | Tested |
|---|---|---|
| Per-org routing decision (fail-safe v1) | `_shared/copilot-v2/engine-router.ts` `decideEngine` | 9 |
| Webhook routing orchestration (fail-safe contract) | `engine-router.ts` `routeCopilotInbound` | 6 |
| Webhook wiring (flag → v1 queue \| v2 border) | `whatsapp-webhook/index.ts` `triggerReactions` | glue (logic in `routeCopilotInbound`) |
| v1→v2 archetype map | `_shared/copilot-v2/v1-archetype-map.ts` | 10 |
| v1→v2 wizard prefill (slots + gaps + dropped) | `_shared/copilot-v2/v1-prefill.ts` | 12 |
| Turn history assembly (eval-safe) + whatsapp_messages mappers | `_shared/copilot-v2/turn-history.ts` | 7 |
| History injection into the turn | `cognition-worker.ts` + worker `resolveContext` | 2 (+ suite) |
| Per-org cutover readiness gate | `_shared/copilot-v2/cutover-readiness.ts` | 5 |

**Zero new migrations.** The flag column already exists in dev+prod; transcript
continuity reuses the existing `whatsapp_messages` store.

---

## 1. Routing flag — `organizations.copilot_engine_version`

- `text NOT NULL DEFAULT 'v1'`, `CHECK (… IN ('v1','v2'))`. Already present in **dev and prod** (migration `20260426030000`). All 64 prod orgs + 23 dev orgs are currently `'v1'`.
- The column was originally minted for the abandoned GEN-1↔GEN-2 A/B and was read **inertly** by `agent-message`. Slice 12 **repurposes** it: `'v2'` now means GEN-3 (copilot-v2).
- **Cutover one org:** `UPDATE organizations SET copilot_engine_version='v2' WHERE id='<org>';`
- **Rollback one org:** `UPDATE organizations SET copilot_engine_version='v1' WHERE id='<org>';`
- The webhook reads it per inbound; `decideEngine` routes to v2 **only** on the exact string `'v2'` — null / legacy / unknown / read-error all stay v1. A bug in the read cannot divert inbound to v2.

---

## 2. Per-org cutover procedure (Milennials-first → org-a-org)

For each org, in order, **one at a time**:

1. **Prefill + configure the v2 agent(s)** in the wizard (Slice 8). The prefill
   seed (`v1-prefill.ts`) maps the org's v1 `copilot_agents` → v2 slots; the CTO
   reviews `gaps` (must-fill for activation) and `dropped` (v1 fields with no v2
   home, preserved in the escape-hatch) and completes the config.
   Archetype seed map: `qualificador→qualificador`, `sdr→qualificador`,
   `followup/agendador/prospectador→vendedor`, `custom→manual`. `carteira` is
   net-new (post-sale) — configured fresh.
2. **Activate** the agent (`set_copilot_v2_agent_active`) — the activation gate
   (`decideActivation`) enforces the required-set.
3. **Dry-run** the agent in the simulator (Slice 9). Must pass.
4. **Flip the flag** to `'v2'` for the org (§1).
5. **Watch the first ~20 live traces.** Use the readiness gate
   (`evaluateCutoverReadiness`, default `minHealthyTraces = 20`): the org counts
   as migrated only when the dry-run passed **and** ≥20 traces are clean (no
   cognition error, no loop block, no cost breach) **and** zero unhealthy traces.
6. If anything is wrong → **rollback** (§3). Do not advance to the next org until
   the current org is green.

`v1 coexists` for every non-flipped org throughout the rollout.

---

## 3. Rollback (instant, no deploy)

- Flip the org's flag back to `'v1'`. New inbound immediately routes to v1 again.
- **In-flight v2 messages drain naturally** — the flag only gates *new* inbound
  routing; messages already in `copilot_v2_message_queue` finish through the v2
  worker (idempotent). **Do not** truncate/discard the v2 queue on rollback.
- If the v2 border itself throws for a flagged org, the webhook logs
  `copilot_v2_route_failed` and does **not** cross-route that message to v1
  (double-processing risk). The remedy is the flag flip, not a code path.

---

## 4. Prod migration apply (CTO-gated, before the FIRST prod flip)

Prod has only the 4 foundation migrations (`20260531174908`, `20260531214954`,
`20260601015114`, `20260601020907`). The full v2 stack must be applied **before**
the first prod org is flipped. Apply in version order (read-only drift check
first with `scripts/mgmt_query_ref.py <prod-ref> scripts/_slice12_inventory.sql`):

```
20260602151330  claim_attempts_reaper      (1-H)
20260602151331  schedule_reaper            (1-H)
20260602194857  proactive_log              (11)
20260602195217  knowledge_ingestion_audit  (7)
20260602195218  schedule_ingestion_reaper  (7)
20260602195335  schedule_proactive         (11)
20260602195354  handoff_dispatch           (5)   ⚠ needs team_members.phone (see note)
20260602195355  hitl                       (5)
20260602195906  match_knowledge_rpc        (7)
20260602210340  send_media_audio_bucket    (6)
20260602210528  send_media_cap             (6)
20260602220000  save_config_rpcs           (8)
20260602230000  eval_cases                 (9)
20260603120000  eval_seed_golden           (W13)  (org-guarded idempotent)
20260603120100  eval_runs_trace_id         (W13)
20260603130000  eval_redteam_col           (W12)
20260603140000  eval_redteam_seed          (W12)  (org-guarded idempotent)
20260603150000  w10_governance             (W10)
```

Notes:
- These are already applied in **dev**. Several are org-guarded/idempotent (eval/redteam seeds) → safe to replay.
- The seed/redteam migrations reference the **Milennials org** — confirm the org exists in prod before applying.
- `handoff_dispatch` (slice 5) `comment on column team_members.phone` assumes the column exists; dev needed `alter table team_members add column if not exists phone text` (nullable). Verify prod has `team_members.phone`.
- Apply isolated via the Management API (`mgmt_query_ref.py`) — **never** `db push` (dev/prod drift; see project memory). Re-run the inventory query after to confirm object parity dev↔prod.

---

## 5. History / continuity (resolved — no migration, no v2 writes)

The "migrate history to v2" premise was false: the transcript lives in the
**shared** tables, not v1-private ones, and v2 already reads it.

- `conversations`/`conversation_messages` are written **only by v1**, and
  `conversations.agent_id` is `NOT NULL` (FK to v1 `copilot_agents`) — v2 cannot
  fabricate those rows.
- `whatsapp_messages` is written **engine-agnostically** by the webhook for every
  inbound, and Uazapi echoes every outbound there too. It is the complete,
  always-current bidirectional transcript for every org.
- **Slice 12 wires v2 to READ `whatsapp_messages`** (worker `resolveContext`,
  last ~20 by lead_id or phone-suffix) and injects it into every turn. No new
  writes, no migration, and pre-cutover history is automatically visible.
- Eval-safety: history is an optional `ResolvedContext.history` field, **empty in
  eval/sim**, so the W13/W12 goldens are byte-identical (verified: full suite +
  eval/red-team gate green, 0 regression).

Follow-up (non-blocking): add a `whatsapp_messages` fallback to the v2
`get_conversation_history` tool so it returns live data for v2 orgs (the turn
already has injected history, so this is secondary).

---

## 6. Decommission GEN-1 (CTO-gated; ONLY after the LAST of 64 orgs is on v2)

**Irreversible.** Deleting v1 breaks any org still flagged `'v1'`. Trigger:
`SELECT count(*) FROM organizations WHERE copilot_engine_version <> 'v2';` returns 0.

v2 has **zero** imports from `_shared/copilot/*` — but there are LIVE v1
consumers that must be unwired first:

**PHASE 0 — extract shared utilities (prerequisite):**
- `copilot-builder` (LIVE, user-facing) imports `OpenRouterClient` from `agent-message/openrouter-client.ts` → move to `_shared/`.
- `process-copilot-followups` (v1 cron) imports `AgentEngine` + `OpenRouterClient` from `agent-message` → refactor to call agent-message over HTTP, or delete with v1.
- **`whatsapp-webhook` imports `_shared/copilot/cancellation.ts`** (`isCopilotCanceled`/`logCopilotCancellation`), used only inside `dispatchAgentMessageFallback` (the v1 fallback extracted in Slice 12). When the fallback is deleted, drop this import too. *(This consumer was missed by the initial decommission scan — verify with a fresh grep before deleting `_shared/copilot/`.)*

**PHASE 1 — unschedule v1 crons:** `process-copilot-followups`, `cleanup-copilot-batching`.

**PHASE 2 — neutralize v1 enqueue:** remove the `copilot_message_queue` insert + `dispatchAgentMessageFallback` from `whatsapp-webhook` (the whole `engine === 'v1'` path; the webhook then only routes v2).

**PHASE 3 — drop trigger:** the `copilot_message_queue` → pg_net notify trigger (before dropping the table) + its `cron_config` rows.

**PHASE 4 — drop tables/fns:** `copilot_message_queue`, `copilot_processing_locks`, and the v1 batch/lock functions.

**PHASE 5 — delete edge fns:** `process-copilot-followups`, `copilot-batch-processor`, then `agent-message` (after Phase 0).

**PHASE 6 — delete v1 shared modules:** `_shared/copilot/*` (verify `grep -r "_shared/copilot/" supabase/functions` is empty first — including the webhook's `cancellation.ts` import from Phase 0).

**PHASE 7 — config.toml:** remove `[functions.agent-message]`, `[functions.copilot-batch-processor]`, `[functions.process-copilot-followups]`.

**PHASE 8 — flag cleanup (optional):** the `agent-message` inert reads of `copilot_engine_version` + the master `EngineTab` UI/hooks (`useOrgsCopilotEngine`/`useToggleCopilotEngine`). Keep the column itself (now the routing flag).

Pre-delete safety check: `SELECT count(*) FROM organizations WHERE copilot_engine_version <> 'v2'` = 0, and `grep -r "from.*agent-message" supabase/functions` shows only the (deleted) v1 files.
