# Incident — Uazapi V2 schema change (2026-05-14)

**Severity**: High — 8 production orgs lost all inbound WhatsApp for ~22 hours.
**Start**: 2026-05-14 ~20:00 UTC
**Detection**: 2026-05-15 ~12:30 UTC (CTO investigation triggered by Barulinho Bom report)
**Mitigation**: 2026-05-15 13:28 UTC (patch + webhook rebind deployed)
**Status**: Resolved. Hardening plan tracked in `WHATSAPP_STABILITY_PLAN.md`.

## Timeline

| UTC | Event |
|---|---|
| 2026-05-14 19:00 | Normal inbound volume across all Uazapi orgs (~2386 msgs/hr) |
| 2026-05-14 ~20:00 | Uazapi server-side release: payload schema V2 changes. Top-level `instance` field stops being reliably present. |
| 2026-05-14 20:00 | `uazapi_missing_instance` errors jump from baseline to 504/hr |
| 2026-05-14 → 2026-05-15 | 3904 inbound webhook events silently dropped (HTTP 200, no DB insert). Outbound unaffected (uses different code path). |
| 2026-05-15 12:30 | Investigation begins. Pattern identified: only Uazapi-provider orgs broken; Evolution-provider orgs unaffected. |
| 2026-05-15 13:25 | Root cause confirmed via Uazapi `/instance/all` + `/message/find` admin probes: messages exist in Uazapi mirror DB, webhook delivery to V8 succeeds (HTTP 200) but events fail instance resolution. |
| 2026-05-15 13:27 | Defensive patch deployed to `whatsapp-webhook`. |
| 2026-05-15 13:28 | 39 Uazapi instances rebound with canonical webhook config (Padrão A: `addUrlEvents=true`, URL=/SECRET, `excludeMessages=["wasSentByApi"]`). |
| 2026-05-15 13:29 | Inbound resumed. `uazapi_missing_instance` drops to 0/min. `uazapi_resolved_by_token_fallback` (new path from patch) handles ~50% of events. |
| 2026-05-15 13:46 | 13 backfill jobs queued in `history_sync_jobs` (scope=incremental, max_days=2) to recover the 22h gap from Uazapi mirror DB. |

## Root cause

Uazapi rolled a server-side update that changed webhook payload shape. Three observed payload variants post-update:

1. **Event as string** — `{"event": "messages", ...}` — known event types
2. **Event as instance_id string** — `{"event": "<uazapi_instance_id>", ...}` — instance id misplaced in event field
3. **Event as object** — `{"event": {Chat, Type, IsGroup, IsFromMe, Timestamp, MessageIDs, sender_pn, sender_lid, chatlid}, ...}` — full event data with PascalCase fields

**None of these reliably carry a top-level `instance` or `instance_id` field.**

The `whatsapp-webhook` handler resolved instance via:

```ts
const uazapiInstanceId = payload.instance ?? payload.instance_id ?? pathInstanceId ?? payload.instanceName ?? null;
```

Failure modes:

1. **Empty-string short-circuit**: when Uazapi V2 sent `instance: ""` the `??` chain accepted the empty string. The downstream `if (!uazapiInstanceId)` correctly caught it as falsy but lost the chance to fall through to other candidates.
2. **Padrão A URLs** (canonical, `addUrlEvents=true`): URL is `.../SECRET` and Uazapi appends the event name (`/messages`, `/connection`). For these instances `pathInstanceId` is undefined — without `payload.instance` there is no way to resolve.
3. **Padrão B URLs** (legacy, `addUrlEvents=false`, URL=`.../SECRET/<uazapi_instance_id>`): `pathInstanceId` resolved fine, but instances paired before the V2 release also reported drops — implying Uazapi may have re-routed deliveries through a path that does not include the instance segment after the update.

The 56% of events that still resolved came from event types that retained an identifying field in the payload body (e.g., `messages` event with full message object containing `owner` jid).

## Why outbound kept working

Outbound is driven by V8 → Uazapi POST `/send/text` calls using the per-instance `uazapi_token` fetched via `get_uazapi_credentials` RPC. That path is independent of webhook delivery and the per-instance token kept authenticating against Uazapi successfully.

## Why Evolution orgs were unaffected

Evolution uses an independent provider (`EvolutionProvider`) with its own webhook handler path. Its payload shape did not change.

## Mitigation (deployed)

### 1. Defensive patch — `supabase/functions/whatsapp-webhook/index.ts`

Replaced the brittle `??` chain with two helpers:

- `pickInstanceId(payload, pathInstanceId)`: trims candidates, skips empty strings, tries `instance`, `instance_id`, `instanceId`, `InstanceId`, `InstanceID`, `instanceID`, `instanceName`, `InstanceName`.
- `pickUazapiToken(payload)`: same defense for the per-instance token (`token`, `Token`, `instance_token`, `instanceToken`).

Added a new resolution path `resolveInstanceByToken` that maps `whatsapp_instance_secrets.uazapi_token` → instance row when the primary resolution misses.

Added diagnostic logging: `uazapi_missing_instance` events now include `url_path` and a 2KB truncated raw payload snippet. New action `uazapi_resolved_by_token_fallback` records every save so the fallback rate is observable.

### 2. Webhook rebind — 39 Uazapi instances

Direct admin-token call to Uazapi `POST /webhook` per V8-linked instance with canonical config:

```json
{
  "url": "https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/whatsapp-webhook/<UAZAPI_WEBHOOK_SECRET>",
  "events": ["messages", "messages_update", "connection"],
  "excludeMessages": ["wasSentByApi"],
  "addUrlEvents": true,
  "addUrlTypesMessages": false,
  "enabled": true,
  "action": "update"
}
```

39/39 returned HTTP 200. Inbound resumed within seconds.

### 3. New edge function — `supabase/functions/whatsapp-rebind-webhook/`

Generic operator/automation entry point to re-register webhooks for a scoped subset of Uazapi instances. Scopes: `stale` (default, last_connection_at older than N hours), `instance_ids`, `org_ids`, `all`. Supports `dry_run`. Auth via `x-cron-secret` or service_role bearer. Uses `UazapiProvider.reconfigureWebhook` so the config stays in sync with the canonical definition in code.

Deployed but not used during the live incident (direct API call was faster); kept for future incidents and as the auto-rebind action target for the health monitor (component 3 of the stability plan).

### 4. Backfill — 13 `history_sync_jobs`

scope=`incremental`, max_days=2, triggered_by=`incremental`. Worker `history-sync-worker` (existing pg_cron, 1min) processes them as it frees from other in-flight default-scope jobs.

Affected instances backfilled:

| Org | Instance |
|---|---|
| Alamaster | CLAUDIO SANTOS (COMERCIAL), FINANCEIRO, RAFAELLA (ESTOQUE) |
| Barulinho Bom | BARULHINHOBOMVENDASONLINE |
| Brasil Engrenagens | comercial 1 |
| Mapila Alimentos | Comercial 1 (Weberth), Comercial 2 (Lorenna) |
| Maria Bonita | Comercial 01 |
| Milennials | Furstenberg SDR, mikelli, sdr |
| REALSC | 4899626764, Prospecçao |

## Sessions found dead (separate issue, surfaced during investigation)

6 V8-linked Uazapi instances were `disconnected` with reason `401: logged out from another device`:

- Comercial 1 (test org), mikelli (Milennials), PROSPECÇAO (REALSC, uppercase variant), Comercial (Sayonara) (test org), Nicoladeli (test org), JUAN (MONIT) (Alamaster)

These require human QR pairing — they are not recoverable via admin API and represent ongoing message loss for those numbers. Watchdog (component 2 of the stability plan) will surface this state automatically.

## Verification

- `uazapi_missing_instance` rate: 17–68/min before patch → 0/min after.
- `uazapi_resolved_by_token_fallback`: 0 (didn't exist) → ~50% of all post-rebind Uazapi events. Token-only resolution is carrying half the load, confirming the V2 schema hypothesis empirically.
- Affected orgs receiving inbound again within minutes (Alamaster 1823 msgs in 20min post-rebind, REALSC 6, Basic4u 12, Barulinho Bom 1).
