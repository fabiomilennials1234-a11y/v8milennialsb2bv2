# 16. Per-recipient delivery-failure tracking via provider poll (async sent→failed reclassification)

Date: 2026-07-02

## Status

Accepted

Extends ADR-0003/ADR-0015 (Blast Plans). Introduces the Blast Recipient Status taxonomy (see CONTEXT.md) surfaced by the Disparos drill-down.

## Context

`blast_plan_recipients.status` knows only `pending | sent | skipped`, and `sent` is written **at dispatch time** — it means "handed to the sending queue", not "reached the Lead's WhatsApp". Real delivery failures (invalid number, banned number, provider rejection) exist only as aggregate counters on `uazapi_sender_jobs` (`sent`/`failed` per folder, polled by the `mass-send-status` cron). The operator drilling into a blast cannot answer "which Leads failed?" — the per-lead link is missing at both ends: the recipient row has no failure state, and the sender job doesn't record which plan/lot it dispatched.

Two mechanisms could close the gap:

- **Webhook ack correlation** (`messages_update` events): real-time, but Uazapi sender-folder messages are created provider-side — we hold no per-message ids to correlate against, so matching degrades to phone+instance+time-window heuristics on a high-volume event stream, for freshness the operator doesn't need.
- **Poll the folder**: the `mass-send-status` cron already polls every running folder each minute; extend it to fetch the folder's per-message statuses and write failures back to the matching recipient rows.

## Decision

1. **Poll, not webhook.** The existing `mass-send-status` cron is extended: for each polled folder it fetches per-message statuses from the provider and marks failed sends on `blast_plan_recipients` — `status = 'failed'`, `reason` = the provider's failure code. A spike resolves the exact Uazapi endpoint (`/sender/listmessages` or equivalent); if no per-message endpoint exists, the fallback is webhook ack correlation, and this ADR must be amended.

2. **Recipients are matched by phone within the folder.** Good enough because a folder belongs to exactly one plan+lot dispatch (see 3), so phone is unique inside it.

3. **The dispatch records its provenance.** `runUazapiSenderJob` writes `{ plan_id, lot_index }` into `uazapi_sender_jobs.payload` when `trackSource = "blast-plan"` — the missing plan→folder link. No new column; the payload jsonb is already the job's context bag.

4. **`sent` is deliberately optimistic and may be reclassified.** The recipient CHECK gains `'failed'`. A row is marked `sent` at dispatch and may flip to `failed` minutes later when the poll reports back. The UI presents this honestly: "Enviado" = accepted by the queue, with async migration to "Falha na entrega". No read-receipt semantics are implied or tracked.

5. **Skipped reasons become granular.** The releaser already computes *why* each recipient was refined away but flattens it to `reason = 'refined'`; it now writes `'replied'` or `'recency'` per row. Legacy `'refined'` rows render as a generic motive — no retrofit.

## Consequences

- Failure visibility lags dispatch by the cron cadence (~1 minute while the folder is running). Accepted: the operator's question is "which leads failed?", not "notify me the second one fails".
- `sent` stops being terminal for a recipient row. Any consumer summing `sent` as "delivered" must treat `failed` as its own bucket (the drill-down and progress counters do).
- Old plans (dispatched before the payload link existed) cannot be back-filled — their drill-down shows no failure group. Deliberate: no heuristic retrofit.
- The blast-plan core keeps zero provider awareness: failure write-back lives entirely in the status-sync path, preserving the store/dispatch seam that makes the core unit-testable.
