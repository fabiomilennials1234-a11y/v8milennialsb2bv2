---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-04-08-fix-pipe-dispatch-timeout.md
---

# Fix Pipe Rule Dispatch Timeout & Stuck Queue

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the pipe-rule-dispatch worker that dies mid-batch due to Edge Function timeout, leaving items stuck in `processing` and leads accumulated in `Novo`.

**Architecture:** Reduce batch to 5 send_templates max per invocation, cache org rate limit config outside the loop, reduce stale threshold from 5min to 2min, and add a `send_count` guard that exits the loop early. Non-send actions (wait_response, change_stage, assign_sdr, cancel_sequence) are lightweight and don't need rate limit delays, so they can process up to the full batch.

**Tech Stack:** Supabase Edge Functions (Deno), PostgreSQL (pg_cron, pg_net), TypeScript

**Root Causes Confirmed:**
1. **Primary:** The `randomDelay(30000, 90000)` between each `send_template` means 2-3 sends already consume 60-270s. Edge Functions timeout at ~150-400s. The batch size of 50 guarantees timeout.
2. **Secondary:** Rate limit config is fetched from DB on every iteration (`organizations.whatsapp_rate_limit`), adding unnecessary latency.
3. **Tertiary:** Stale threshold of 5 minutes means items stuck in `processing` (from crashed workers) are unavailable for 5 minutes, creating a dead zone where pg_cron fires but nothing is processable.

---

## Task 1: Reduce send_template batch limit and cache rate config

**Files:**
- Modify: `supabase/functions/pipe-rule-dispatch/index.ts:32-34` (constants)
- Modify: `supabase/functions/pipe-rule-dispatch/index.ts:313-473` (processing loop)

- [ ] **Step 1: Add MAX_SENDS constant and reduce STALE_MINUTES**

At the top of the file (line ~34), change:

```typescript
const BATCH_SIZE = 50;
```

to:

```typescript
const BATCH_SIZE = 50;
const MAX_SENDS_PER_RUN = 5;
```

- [ ] **Step 2: Cache rate limit config before the loop**

Before the `for (const row of rows)` loop (line ~312), add rate limit cache:

```typescript
// Cache rate limit config per org to avoid N+1 queries
const rateLimitCache = new Map<string, { minDelay: number; maxDelay: number }>();
async function getOrgRateLimit(orgId: string) {
  if (rateLimitCache.has(orgId)) return rateLimitCache.get(orgId)!;
  const { data: org } = await supabase.from("organizations").select("whatsapp_rate_limit").eq("id", orgId).single();
  const rl = org?.whatsapp_rate_limit || {};
  const config = { minDelay: rl.delay_min_ms ?? DEFAULT_DELAY_MIN_MS, maxDelay: rl.delay_max_ms ?? DEFAULT_DELAY_MAX_MS };
  rateLimitCache.set(orgId, config);
  return config;
}
```

- [ ] **Step 3: Add send counter and early exit in the loop**

Inside the `for (const row of rows)` loop, after the `send_template` success/failure block (around line 466), replace:

```typescript
// Delay between sends
const { data: org } = await supabase.from("organizations").select("whatsapp_rate_limit").eq("id", orgId).single();
const rateLimit = org?.whatsapp_rate_limit || {};
const minDelay = rateLimit.delay_min_ms ?? DEFAULT_DELAY_MIN_MS;
const maxDelay = rateLimit.delay_max_ms ?? DEFAULT_DELAY_MAX_MS;
await randomDelay(minDelay, maxDelay);
```

with:

```typescript
// Delay between sends (cached)
const rlConfig = await getOrgRateLimit(orgId);
await randomDelay(rlConfig.minDelay, rlConfig.maxDelay);

// Guard: stop after MAX_SENDS to avoid Edge Function timeout
if (sent + failed >= MAX_SENDS_PER_RUN) {
  console.log(`[pipe-rule-dispatch][${pipeType}] Max sends reached (${MAX_SENDS_PER_RUN}), stopping batch`);
  // Release remaining claimed items back to scheduled
  const remainingIds = rows.slice(rows.indexOf(row) + 1).map((r) => r.id);
  if (remainingIds.length > 0) {
    await supabase.from("scheduled_pipe_messages")
      .update({ status: "scheduled" })
      .in("id", remainingIds)
      .eq("status", "processing");
  }
  break;
}
```

- [ ] **Step 4: Reduce stale threshold from 5 to 2 minutes**

In `processPipeQueue` (line ~219), change:

```typescript
const STALE_MINUTES = 5;
```

to:

```typescript
const STALE_MINUTES = 2;
```

And in multi-pipe mode (line ~133), change:

```typescript
const STALE_MINUTES_GLOBAL = 5;
```

to:

```typescript
const STALE_MINUTES_GLOBAL = 2;
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit` (no frontend changes, but verify no import issues)
Expected: No new errors

```bash
git add supabase/functions/pipe-rule-dispatch/index.ts
git commit -m "fix(dispatch): limit sends per run, cache rate config, reduce stale threshold"
```

---

## Task 2: Create migration for backlog recovery

**Files:**
- Create: `supabase/migrations/20260908000000_fix_pipe_dispatch_stuck_items.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- FIX: Recover stuck pipe dispatch items
--
-- Problem: Worker timeout during batch processing leaves items in 'processing'
-- or 'scheduled' with past scheduled_at. Also items in 'failed' that can be
-- safely retried.
--
-- This migration:
--   1. Resets 'processing' items back to 'scheduled' (crashed workers)
--   2. Reschedules 'failed' items that failed due to transient errors
--   3. Does NOT touch 'waiting_response', 'sent', 'executed', 'cancelled'
--
-- Safe to run multiple times (idempotent).
-- =============================================================================

-- 1. Reset stuck processing items
UPDATE public.scheduled_pipe_messages
SET status = 'scheduled', scheduled_at = now()
WHERE status = 'processing';

-- 2. Retry failed items with transient errors (rate limit, no instance, send failed)
-- Excludes permanent failures like "Missing template" or "Lead has no phone"
UPDATE public.scheduled_pipe_messages
SET status = 'scheduled', scheduled_at = now(), error_message = 'retried: ' || COALESCE(error_message, '')
WHERE status = 'failed'
  AND error_message IS NOT NULL
  AND error_message NOT LIKE '%Missing template%'
  AND error_message NOT LIKE '%Lead has no phone%'
  AND error_message NOT LIKE '%Missing organization%';

-- 3. Report status
DO $$
DECLARE
  v_scheduled INT;
  v_processing INT;
  v_failed INT;
  v_waiting INT;
  v_sent INT;
BEGIN
  SELECT COUNT(*) INTO v_scheduled FROM public.scheduled_pipe_messages WHERE status = 'scheduled';
  SELECT COUNT(*) INTO v_processing FROM public.scheduled_pipe_messages WHERE status = 'processing';
  SELECT COUNT(*) INTO v_failed FROM public.scheduled_pipe_messages WHERE status = 'failed';
  SELECT COUNT(*) INTO v_waiting FROM public.scheduled_pipe_messages WHERE status = 'waiting_response';
  SELECT COUNT(*) INTO v_sent FROM public.scheduled_pipe_messages WHERE status = 'sent';

  RAISE NOTICE '=== Pipe Dispatch Queue Status ===';
  RAISE NOTICE 'scheduled: %', v_scheduled;
  RAISE NOTICE 'processing: %', v_processing;
  RAISE NOTICE 'failed: %', v_failed;
  RAISE NOTICE 'waiting_response: %', v_waiting;
  RAISE NOTICE 'sent: %', v_sent;
END $$;

SELECT status, COUNT(*) as total
FROM public.scheduled_pipe_messages
GROUP BY status
ORDER BY status;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260908000000_fix_pipe_dispatch_stuck_items.sql
git commit -m "fix(dispatch): migration to recover stuck and failed queue items"
```

---

## Task 3: Add frontend visibility for queue health

**Files:**
- Modify: `src/components/pipelines/PipeDispatchRulesSection.tsx` (add stuck items indicator)

- [ ] **Step 1: Add processing count to metrics query**

In the metrics query (usePipeDispatchMetrics or inline), ensure `processing` status is included in the counts displayed to the admin. Find the metrics aggregation section and verify that `processing` items are visible.

If the frontend already shows `scheduled` count as "Pendentes", add a `processing` indicator next to it, or merge them visually so the admin sees "X pendentes (Y em processamento)".

- [ ] **Step 2: Commit**

```bash
git add src/components/pipelines/PipeDispatchRulesSection.tsx
git commit -m "fix(dispatch): show processing items count in queue metrics"
```


## Links relacionados

- [[Regras de Pipe]]

- [[WhatsApp Evolution]]

- [[00 - INDEX]]
