# WhatsApp Stability Plan

Hardening plan to make the WhatsApp pipeline (Uazapi → V8 webhook → DB → UI) safe and self-healing. Triggered by the 2026-05-14 incident (see `INCIDENT_2026_05_14_UAZAPI_V2.md`).

Scope: **stability and observability only**. No new user-facing features. Six components, prioritised by impact-per-hour.

## Principles

1. **Messages never silently disappear** — every WhatsApp event reaches the DB or surfaces as an audible error.
2. **Visible state equals real state** — the UI never lies about delivery or connectivity.
3. **Failures alarm** — drift, dead sessions, and webhook 5xxs raise alerts before they become incidents.
4. **Automatic recovery** — common gaps self-correct without human intervention.

## Components

### 1. Dead Letter Queue (DLQ) — inbound webhook

Eventos that fail instance resolution (or any unrecoverable parse error) land in a `whatsapp_webhook_dlq` table instead of being silently dropped. A cron-driven replay edge function retries them.

**Why first**: Even with the V2 patch deployed, future schema drift will leak events. DLQ guarantees no future silent loss.

**Schema** (migration):

```sql
CREATE TABLE public.whatsapp_webhook_dlq (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  source_ip text,
  url_path text,
  event text,
  reason text NOT NULL,             -- 'missing_instance' | 'unknown_instance' | 'parse_error' | ...
  payload jsonb NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error text,
  resolved_at timestamptz,           -- non-null when replay succeeded
  resolved_instance_id uuid REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_whatsapp_webhook_dlq_pending ON public.whatsapp_webhook_dlq(received_at) WHERE resolved_at IS NULL;
ALTER TABLE public.whatsapp_webhook_dlq ENABLE ROW LEVEL SECURITY;
-- service_role only — no app-tier access.
```

**Producer**: `whatsapp-webhook` writes to DLQ in the existing `uazapi_missing_instance` / `uazapi_unknown_instance` branches before returning 200.

**Consumer**: new edge function `whatsapp-dlq-replay`. Cron every 5min. Picks up to N pending rows, retries resolution (instance may have appeared since via rebind/repair), inserts message if successful, otherwise increments `attempts`. After 5 attempts → Sentry critical + leave for manual review.

### 2. Watchdog — WhatsApp session liveness

Cron 10min calls Uazapi `/instance/status` per V8-linked Uazapi instance. Maps Uazapi status → our `whatsapp_instances.status`. When a session is detected dead (`disconnected` with reason like `logged out from another device`) it:

- Stamps `whatsapp_instances.session_dead_since` (new column).
- Notifies the org owner via push notification + email.
- Returns a UI banner on every WhatsApp-related page until the session is back.

**Why second**: 6 production instances are dead right now and the owners do not know. Watchdog is the difference between "noticed in 10min" and "noticed when a sales call fails next week".

### 3. Health Monitor + Auto-Rebind

Cron 5min `whatsapp-health-monitor`. Per Uazapi instance with `status=connected`:

```
v8_count_1h     = SELECT count FROM whatsapp_messages WHERE instance_id=X AND direction='incoming' AND created_at > now() - interval '1 hour';
uazapi_count_1h = POST /message/find { fromMe:false, after:now-1h, limit:200, isGroup:false }  -- via instance token
drift           = v8_count_1h / max(uazapi_count_1h, 1)
```

Classification:

| drift | status | action |
|---|---|---|
| ≥ 0.9 | `healthy` | log only |
| 0.5 – 0.9 | `warning` | log + Sentry breadcrumb |
| < 0.5 | `critical` | trigger `whatsapp-rebind-webhook` (scoped) + Sentry alert |
| < 0.5 for 2 consecutive cycles | `rebind_triggered` | push notification to CTO |

Rebind cooldown: max 1 per instance per 30min. Results persisted in `whatsapp_health_checks` for trending.

**Why third**: Detects new schema drift / stuck Uazapi queue automatically. Without this, the next vendor change repeats the 22h outage.

### 4. Realtime client — robustness

`useWhatsAppRealtime` today is fire-and-forget over Supabase Realtime. It assumes the websocket stays up and that every postgres_change reaches the browser. Both are not guaranteed.

Additions:

- **Heartbeat**: send a ping every 30s on the channel. If no server ACK for 60s, force `channel.unsubscribe()` + `subscribe()`. On reconnect, refetch the active chat once.
- **Status badge**: render `🟢 conectado` / `🟡 reconectando` / `🔴 offline` in the chat header, driven by channel state events.
- **Visibility / network reconnect**: on `document.visibilitychange === "visible"` or `online` event, force a channel refresh + targeted refetch.
- **Fallback polling**: when channel state has been off the `joined` for > 2min, switch the active chat to `useQuery` with `refetchInterval: 10_000` until reconnect succeeds.

Implementation lives in `src/hooks/chat/useWhatsAppRealtime.ts` (or a sibling `useRealtimeChannelHealth.ts`) and a new `ChatRealtimeStatusBadge` component.

### 5. Audit + Telemetry

- New column `whatsapp_messages.received_via` with values `webhook` (default) | `history_sync` | `dlq_replay` | `manual_replay`. Populated at insert time by each writer.
- Internal page `/admin/whatsapp-health` (master/admin only): per-instance card showing 7-day inbound count by `received_via`, last health check, last gap event, last auto-rebind, current drift, session status.
- Sentry tags per webhook handler: `instance_id`, `org_id`, `provider`, `event_type`. Enables per-tenant slicing.
- Sentry alerts: `uazapi_missing_instance > 5/min`, `uazapi_5xx`, `whatsapp_session_dead`, `dlq_pending > 100`.

### 6. Contract tests — Uazapi V2

Vitest suite that posts each of the three observed V2 payload shapes against the `whatsapp-webhook` handler (locally mounted) and asserts the message lands in the DB with the expected fields.

- Fixtures in `tests/integration/fixtures/uazapi-v2/*.json`.
- Daily cron edge function `whatsapp-schema-snapshot` samples 100 live raw payloads per event type (post-DLQ replay) and writes a JSON snapshot to `whatsapp_schema_snapshots`. CI compares against the previous snapshot; new top-level keys or missing required keys block the merge.

## Ordering

| # | Component | Effort | Status |
|---|---|---|---|
| 0 | Live incident mitigation (patch + rebind + backfill) | done | ✅ deployed 2026-05-15 |
| 1 | DLQ | 2h | ☐ |
| 2 | Watchdog session | 2h | ☐ |
| 3 | Health monitor + auto-rebind | 3h | ☐ |
| 4 | Realtime client robustness | 3h | ☐ |
| 5 | Audit + telemetry | 2h | ☐ |
| 6 | Contract tests | 2h | ☐ |

Critical (1+2+3) = 7h. Important (4+5) = 5h. Hardening (6) = 2h. **Total ~14h.**

## Out of scope

- `sent_source='phone'` distinction and UI badge (feature, not stability).
- Presence events (UX upgrade).
- Structural refactor of the Uazapi client.

## Rollback plan

Each component lands in its own commit / migration / edge function. Rollback per component:

- DLQ: drop table + revert `whatsapp-webhook` write to DLQ branch.
- Watchdog: drop column + delete edge function + drop pg_cron entry.
- Health monitor: drop table + delete edge function + drop pg_cron entry.
- Realtime: revert hook + remove badge component.
- Audit: drop column + delete dashboard page.
- Contract tests: delete fixtures + remove from CI.

No component depends on the next, so partial rollback is safe.
