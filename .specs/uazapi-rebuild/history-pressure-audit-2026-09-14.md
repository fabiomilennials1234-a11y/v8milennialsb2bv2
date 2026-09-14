# History import pressure — 2026-09-14

## Production evidence

- Eighteen `history_sync_tick_skipped` logs in the sampled 24-hour window. Latest six reported 60–61% pressure with **zero jobs waiting**. No queued/running history jobs in the inspected snapshot.
- `db_connection_pressure` measures client connection occupancy, including idle connections. Separate snapshot: 48 idle, 2 active. This does not measure CPU/I/O or establish history as the cause of global database pressure.
- Old persistence attempted one upsert per message, including known IDs. Production has nine message triggers. Four live-effect triggers had no history exclusion: notifications, outbound webhooks, manual-send AI pause, response detection for campaign/pipeline progression.
- Controlled TorqueSDR read: UAZAPI HTTP 200, 100 rows, 94 IDs already in CRM. Persistence simulation required one lookup and one write batch instead of 100 write attempts. This read test made no production writes and is not a CPU benchmark.

## Changes

- Empty or deferred queues return before pressure RPC/logging. The 60% pressure gate remains active for eligible work.
- Query existing IDs within organization + instance, then write only missing IDs in sequential batches of 25. Existing receipts/reactions are preserved; conflict-ignore still handles races with live ingestion.
- Invalid SQL data/integrity rows are isolated by bounded batch splitting. Resource/network failures stop additional writes, requeue the same page and preserve the prior cursor/progress. Partial first-page retries bypass recent-message shortcuts, avoiding false completion after a partial import.
- Four INSERT trigger predicates exclude only `received_via = history_sync`. Live events, including legacy NULL source, retain their behavior. Normalization, lead resolution, lead timeline, contact names and conversation summary remain active.
- Existing organization quota, full-import time window and concurrency limits are retained. No grants/RLS/auth changes.

## UAZAPI contract

Official source: https://docs.uazapi.com/openapi-bundled.json (2.1.1).

`/message/find` reads provider-stored messages with chat ID, limit and offset; this is the adapter's existing import path. `/message/history-sync` requests older content from the connected device and delivers history asynchronously. They are different operations. No promise of complete lifetime WhatsApp history: provider retention/device availability constrain recovery.

## Validation and limits

- Eleven Vitest tests (persistence + progress), twelve Deno guard tests; full worker Deno check passed.
- SQL positive/negative test clones actual trigger definitions onto temporary tables with recorder functions. Historical incoming/outgoing rows fire zero live effects; live/NULL-source rows retain all expected calls and direction filtering.
- Migration, test and captured rollback executed inside one production transaction and rolled back. No customer rows inserted. CTO requested production validation without another Supabase branch; this replaces preview QA for this narrow change.
- No full-load import or CPU reduction claim. Remaining row-level summary/timeline work and global connection consumers require measurements under a real import before further changes. Generic offset pagination also cannot guarantee a stable snapshot during concurrent provider inserts.
- Publication and post-deploy results recorded in the PR; this document's checks precede publication.
