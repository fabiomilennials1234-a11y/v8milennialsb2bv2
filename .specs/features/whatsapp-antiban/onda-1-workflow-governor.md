# WhatsApp Anti-ban — Onda 1: Workflow Send Governor

Status: **implemented (code + tests green), DEV deploy pending** — 2026-07-21
Branch: `feat/workflow-send-governor` (worktree cut fresh from origin/main @ `294e2456`)
Scope: reduce WhatsApp ban risk for messages sent by **automations (workflows)**.

## Problem

The three chip-burning incidents (Bennedita Pan, Elvéra, Motor100) were all
**workflow-driven**. The serious anti-ban machinery (per-number cap of 80/day,
org daily budget, quiet-hours) existed only inside the `quick-blast` module — the
workflow send path referenced none of it. Every workflow WhatsApp send passed a
single fixed 3s throttle and nothing else. Onda 0 (PR #1120) added inter-recipient
jitter + a ban-signal telemetry, but ONLY to the mass/cron workers and the uazapi
transport — NOT to the workflow send handlers. Onda 1 closes that gap.

## Decision (approved)

A **phased, defer-first Send Governor** for the workflow path: one choke,
`governOutboundSend()` (+ `commitOutboundSend()` / `governGate()`), that reuses the
blast ledgers, **never fails** (it defers by rescheduling the workflow node), with
each lever behind a `shadow → enforce` sub-flag and a per-org master kill-switch.

**Inviolable safety property:** with the master flag OFF, `governOutboundSend()`
behaves EXACTLY like the old code (fixed 3s throttle, no cap, no quiet-hours, no
defer). **Flag OFF = byte-identical no-op.** Proven by test. This makes the
merge/deploy safe.

## Onda 0 reconciliation (built ON TOP, never duplicated)

| Onda 0 asset | Where it lives in main | How Onda 1 reuses it |
|---|---|---|
| `anti-ban-jitter.ts` (`jitterDelayMs`, `JITTER_MIN_MS=3000`, `JITTER_MAX_MS=8000`) | wired into `process-outbound-dispatches`, `process-scheduled-user-messages`, `process-copilot-followups`, `carteira-bulk-message` (mass/cron loops only) | governor's jitter **default range delegates to `jitterDelayMs`** (`pickJitterTarget`), so a workflow send now spaces out identically to the bulk workers. A tuned per-org `min_ms`/`max_ms` uses the governor's own inclusive picker. |
| `reputation-signal.ts` (`recordBanSignal`, `classifyBanSignal`) | wired at the transport layer inside `uazapi-client.ts` (line ~635), BENEATH every send | governor does **NOT** re-record ban signals (would double-count). The 4xx→ban-signal already fires under the governed send. Consuming that signal to gate cold contacts = Onda 2 cold-lead gate, not this PR. |

The workflow send handlers in main carried NO jitter and NO reputation hook — the
governor is the first anti-ban control on that path, so there was no overlap to
remove, only the legacy fixed `enforceWhatsAppRateLimit(instanceId)` 3s throttle,
which the governor now subsumes (flag OFF keeps it byte-identical).

## Onda 1 scope (this PR) — levers

| Lever | Behaviour | Reuse |
|-------|-----------|-------|
| **jitter** | Replace fixed 3s with random `[3000,8000)ms` spacing since last outgoing. Small wait → sleep inline; large wait → **defer** (protects the `BATCH_SIZE=20` edge timeout). | `anti-ban-jitter.jitterDelayMs` (default range) + `enforceWhatsAppRateLimit` (now takes an interval) |
| **instance cap** | Per-number daily ceiling. Exhausted → defer to next BRT midnight. | `blast_instance_daily_usage` ledger + `resolveInstanceCap` + `increment_instance_daily_usage` |
| **org cap** | Org-wide daily ceiling. Exhausted → defer to next BRT midnight. | `blast_daily_usage` ledger + `computeDailyClamp` + `increment_blast_daily_usage` |
| **quiet hours** | Default ON opt-out, `08:00–20:00 Mon–Sat BRT`. Outside → defer to next open + `random(0,90min)` morning-spread (anti thundering-herd). | `nextValidSendTime` (pure) + BRT wall-clock helpers (`buildDateInTimezone`, `getHourMinutesInTimezone`) |

**Budget is SHARED with Mass Send on purpose** — the ledgers key on
`(instance_id, usage_date)` / `(org_id, usage_date)` with no origin column, so a
workflow send and a blast draw from the same daily line. Intended conservative
behaviour.

## Order of operations (per message)

`gate (governor) → dedup (reserveSendOrSkip) → send → commit`

- `commit` increments BOTH shared ledgers by exactly 1, **only** for `enforce`
  levers, **only** after a real dispatch — never on the dedup-duplicate path,
  never in `shadow`, never when the master flag is off.

## Send classes & exemptions

| Class | Handler(s) | Quiet hours | Caps / jitter |
|-------|-----------|-------------|---------------|
| `automation` | send_whatsapp / media (audio/image/sticker/**document**) / rich (template/menu/pix) | ✅ | ✅ |
| `campaign` | send_campaign_message | ✅ | ✅ |
| `operator_notification` | send_to_number (hand-off) | ❌ exempt (SLA) | ✅ |
| `reminder` | (meeting reminders — reserved) | ❌ exempt | ✅ |
| `automation` (Meta) | send_meta_message (no WA instance) | ✅ | inert (no ledger/commit) |

`send_to_number` (GAP #6) had **no throttle at all** — now gated
(`operator_notification`): jitter + throttle + cap backstop, but skips quiet-hours
(recipients are salespeople; deferring a hand-off blows the lead SLA). Commit fires
per delivered number, never on the dedup path.

> **Gap closed vs the earlier stale draft:** `sendWhatsAppDocument` is a 4th handler
> in `send-whatsapp-media.ts` that the earlier draft missed. It is now gated +
> committed like the other three media handlers.

## Defer guards (the biggest risk — a stuck execution is worse than one extra msg)

1. `deferUntil` ALWAYS clamped to `> now + 60s` (`clampDeferUntil`) — never
   past/now, which would busy-loop the 1-min cron.
2. `context._defer_counts[nodeId]` with ceiling `maxDefers` (default 5): after N
   defers the governor **FAILS OPEN** (sends) + logs terminal. Nothing bricks.
3. A cap-ledger **READ error** → SHORT defer (5 min), NOT defer-till-reset — a
   transient DB blip can never freeze automation for a whole day. `resolveGovernorConfig`
   also fails to DISABLED on a read error (a blip never silently enables the governor
   nor freezes every org).
4. Executor adds `_governor_deferred` to the loop-detection skip-list, so repeated
   defers never trip `loop_limit`.
5. `claim_workflow_executions` filters `next_run_at <= now` (verified in
   `20261001000000_consolidate_workflow_rpcs.sql`) — a future defer genuinely holds
   until due.

The executor's action-case defer handling mirrors the `time_window`/`wait_business_window`
pause: stays on the same `current_node_id`, sets `next_run_at`, status `running`,
records a `governor_deferred` step, does NOT advance the graph, count a retry, or
mark failed. `workflow-action-handler` skips the `lead_history` log on a defer (the
message hasn't been sent — logging it would be a lie in the timeline).

## Config model

Two columns on `organizations` (migration `20270320000000`):

- `workflow_send_governor_enabled boolean NOT NULL DEFAULT false` — master flag.
- `workflow_send_governor jsonb NULL` — per-lever tuning; NULL = code defaults.

```jsonc
{
  "jitter":       { "mode": "enforce", "min_ms": 3000, "max_ms": 8000 },
  "instance_cap": { "mode": "enforce" },
  "org_cap":      { "mode": "enforce" },
  "quiet_hours":  { "mode": "enforce", "days": [1,2,3,4,5,6],
                    "from_minutes": 480, "to_minutes": 1200,
                    "morning_spread_max_min": 90, "timezone": "America/Sao_Paulo" },
  "max_defers": 5
}
```

`mode ∈ off | shadow | enforce`. Governor ON + unset lever ⇒ `enforce`
(protections ON, opt-out via JSONB). Shadow computes the decision and logs
`would_defer` / `would_throttle` to `runtime_logs` (module `whatsapp`, action
`workflow_send_governor`) **without** rescheduling or mutating ledgers. No PII in
logs (ids + counters only; `logger.ts` redacts anyway).

## Files

- New: `supabase/functions/_shared/action-handlers/send-governor.ts`
- New: `supabase/migrations/20270320000000_workflow_send_governor.sql`
- Edited: `whatsapp-helpers.ts` (split `enforceWhatsAppRateLimit` → `getLastOutgoingAt`
  + `intervalMs` param), `action-handlers/types.ts` + `workflow-action-handler.ts`
  (`ActionResult.deferUntil`, `ActionContext.nodeId`, `_nodeId`, defer skips history),
  `workflow-executor.ts` (defer handling + loop-skip + pass `nodeId`), and the 7 send
  handlers (`send-whatsapp`, `-media` ×4, `-rich` ×3, `-campaign-message`,
  `-to-number`, `-meta`).
- Reused (not duplicated): `anti-ban-jitter.ts`, `reputation-signal.ts` (transport),
  `quick-blast/{instance-budget,daily-budget,quiet-hours,plan-slicing}.ts`,
  `copilot/time-context.ts`.
- Tests: `tests/unit/action-handlers/send-governor.test.ts` (pure + orchestrator +
  commit + Onda-0 jitter reuse), governor cases in `send-whatsapp.test.ts`, defer
  cases in `workflow-executor.test.ts`.

## Auto-QA result (2026-07-21)

- `npx vitest run` on the 3 touched files: **60 passed**.
- `deno check` on all new/edited edge files: **0 new errors** (56-error graph
  baseline is identical on pristine HEAD — all in untouched files:
  `workflow-condition-evaluator.ts`, the `wait_business_window`/`BehaviorWindow` case,
  `sanitizeOutput`). `send-governor.ts` checks clean in isolation.
- `eslint` on all touched files: **0 errors** (20 pre-existing `no-explicit-any`
  warnings, none on new lines; `send-governor.ts` warning-free).

## Deploy (DEV only) — HANDOFF, NOT YET DONE

⚠️ **Known blocker:** DEV (`bcfadphgsibjzivtbjvc`) has 5 unrelated unapplied
migrations (`20270314`–`20270319`) and the Supabase MCP lacks permission on that
project. **Do NOT `db push`** (it would drag the whole backlog). Apply ONLY this
migration:

1. Apply `20270320000000_workflow_send_governor.sql` to DEV (single migration, via
   dashboard SQL editor or a scoped `psql` — not `db push`).
2. `supabase functions deploy process-workflow-executions --project-ref bcfadphgsibjzivtbjvc`
   (bundles `_shared/`). Optionally `test-workflow-system` (dev harness).
3. Enable Milennials-dev (`6030520a-2ca7-477d-be89-55758e2cd808`) in **shadow** and
   validate via `runtime_logs`:

```sql
UPDATE organizations
SET workflow_send_governor_enabled = true,
    workflow_send_governor = jsonb_build_object(
      'jitter',       jsonb_build_object('mode','shadow'),
      'instance_cap', jsonb_build_object('mode','shadow'),
      'org_cap',      jsonb_build_object('mode','shadow'),
      'quiet_hours',  jsonb_build_object('mode','shadow')
    )
WHERE id = '6030520a-2ca7-477d-be89-55758e2cd808';
```

Prod deploy: only with explicit CTO approval. NOT in this task.

## NOT in Onda 1 (Onda 2, next PR)

- Warm-up ramp (conservative: d1=8 → ≥d5=cap, **never resets**).
- Cold-lead gate (soft → escalate), consuming the Onda 0 `reputation_ban_signal`.
- New `whatsapp_send_ledger` table (the two existing ledgers suffice).
- Per-org quiet-hours config UI (hardcoded JSONB defaults serve for now).

The lever shape (mode per lever, defer-first, injectable IO seams) is designed to
extend to both Onda 2 levers without reshaping the choke.
