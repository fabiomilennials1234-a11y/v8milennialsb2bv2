# WhatsApp receipt recovery — 2026-09-24

## Scope

This recovery repairs the current `delivered`/`read` state of known outgoing
messages. It does not replay missing webhook history. Uazapi documents no
automatic repeat of unsuccessful `messages_update` HTTP deliveries. Its
`/message/find` endpoint exposes message snapshots, and `/webhook/errors` retains
only 20 failures in memory. Neither proves recovery of pin/unpin, reactions,
edits, deletions, missing messages or original event order.

Sources: [messages_update](https://docs.uazapi.com/webhook/messages_update),
[OpenAPI](https://docs.uazapi.com/openapi-bundled.json),
[webhook errors](https://docs.uazapi.com/endpoint/get/webhook~errors).

## Implementation

- `services/whatsapp-ingress/receipt-recovery.ts` requests one exact provider ID
  at a time, at most 50 candidates, with 10-second request and 60-second lookup
  budgets. Responses must establish exactly one matching ID/chat and outgoing
  direction. Redirects, oversized responses, ambiguous results and unknown
  shapes cannot authorize an update. A provider failure stops the batch;
  no immediate retry or burst of additional requests follows a 429/outage.
- `recovery-runner.ts` reads candidates scoped to the database organization and
  instance. Preview performs no writes or lease transitions. Apply reserves a
  two-minute database lease, compares provider state, and enqueues only validated
  progress through the canonical inbox. It never directly updates message rows.
  Enqueue errors preserve the cursor; uncertain commits are not blindly retried.
- SQL35 maintains a fixed seven-day window and a `(created_at,id)` cursor. The
  51st eligible row determines whether another page exists. Persisted gaps retain
  inconclusive candidate IDs after a page advances, including after the window
  expires; old gaps require explicit assessment rather than an invented replay.
  Recovery pauses when the gate is inline, worker claims are paused, accepted
  work is unresolved, or an organization has a quote awaiting confirmation.
- `recovery-config.ts` requires a separate opt-in and an explicit subset of the
  ingress instance allowlist. Default is off. Enabled instances run sequentially
  in the existing worker process, with a five-minute wait between sweeps.
  The same process shutdown aborts recovery and preserves uncertain leases.
- The HTTP admission path now distinguishes worker health from commit ability.
  An unhealthy worker keeps `/ready` at 503, but an enabled accepting endpoint
  may still durably enqueue. Failed commits and the existing 20k-row/64MiB cap
  continue returning 503. `/health` is process liveness, not successful delivery.

Receipt observation time is not the original delivery/read time. Recovery must
not fabricate commercial consent timing. The environment quote guard and a
conservative database guard exclude organizations with pending quote acceptance.
A trusted `whatsapp_ingress_events.receipt_recovery` column is set only by the
recovery RPC. The worker uses this provenance to suppress quote-presentation
completion even if a quote appears after the guard. A provider JSON marker does
not authorize that bypass. Recovery matches the exact stored message ID rather
than expanding compound IDs to additional candidates.

## Operating the bounded scan

Runtime flags:

```
INGRESS_RECEIPT_RECOVERY_ENABLED=true
INGRESS_RECEIPT_RECOVERY_INSTANCE_IDS=<database UUID already allowed by ingress>
```

`recovery-command.ts <database-instance-UUID>` previews one page using the same
private environment and provider code. Adding `--apply` reserves the real cursor
and enqueues confirmed progress. It never changes provider routing. Exit 0 means
that the bounded page completed without known gaps; 1 means failed/unconfirmed;
2 means partial coverage (more pages or inconclusive rows). Even exit 0 does not
establish universal event recovery. Output is counts only, without message IDs,
phone numbers, payloads, tokens or webhook URLs.

Read `whatsapp_receipt_recovery_state.last_result`, `last_finished_at`, lease and
cursor for liveness; inspect the private gap table for unresolved coverage. All
new objects are service-only, with RLS and no authenticated/anon access. A gap
limit stops progress rather than silently discarding unresolved IDs. A failed
provider lookup retains the current page for a later sweep. A malformed snapshot
is retained as a gap so it cannot permanently starve all later candidates.

At the hard maximum, one instance can request 50 provider snapshots per sweep
(~14,400/day ignoring execution time). These run on the VPS and do not invoke
Supabase Edge Functions; they still use provider API and database resources.
Enable only the measured pilot, never all instances by default.

## Evaluation recorded before activation

- TorqueSDR had 467 outgoing candidates from seven days at the initial census:
  461 delivered, four pending and two sent. Counts may change with live traffic.
  A non-read state is not evidence of a lost receipt.
- A read-only preview checked 50: zero plans, seven inconclusive, zero provider
  errors. No business data changed. This was one page, not the entire window.
- Representative production candidate selection used the existing
  `idx_whatsapp_msgs_org_instance_ts` index; measured execution 42.404 ms for
  51 rows. No new index was added to the large message table for this pilot.
- Existing pilot container remained running with zero restarts; sampled CPU
  0.30%, memory 72.53MiB/512MiB. A point sample is not a peak-capacity test.

## Direct routing remains a separate gate

The provider cannot route only pure receipts: its `messages_update` subscription
also carries operations not recoverable by this scanner. Splitting the existing
route requires separate provider mutations; adding first creates overlap,
removing first creates a gap. Configuration readback cannot reconstruct events
lost or reordered between those operations. Payload fingerprint deduplication
cannot safely distinguish a repeated pin from `pin → unpin → pin`.

Do not represent this partial status repair as closing the direct-route gate.
Keep the current provider URL and same-URL Edge→inbox pilot until durable
provider replay or another tested event source covers these operations and the
transition. No invocation reduction is attributed to status reconciliation or
the current bridge. The prospective 1.84M/31-day scenario still assumes all
updates actually leave Edge; it is not achieved by this release.

## Rollback

Disable only the recovery flag and stop/restart the sole worker with its existing
claim pause/drain procedure. Accepted recovery events stay in the canonical inbox
and must drain normally. The SQL rollback refuses a live recovery lease and only
revokes the recovery RPCs, retaining cursor/gap evidence. Never revert Edge gate
admission while accepted events remain. No provider mutation is part of this
release or its rollback.


## Production activation and validation

SQL35 was applied as ledger `20260924163948`. Readback confirmed anon and
authenticated cannot execute the recovery RPC or read checkpoint state; service
role has EXECUTE/SELECT but no direct checkpoint UPDATE. Existing inbox rows
remained `receipt_recovery=false`. No ephemeral database branch was created.

Worker image `torque-whatsapp-ingress:recovery-20260924-v3` replaced the sole
container after claim pause revision 3 and an empty processing readback. Seven
critical source modules matched image bytes. Health passed first with recovery
off; only the TorqueSDR recovery allowlist was then enabled. Claims resumed at
revision 4. Admission remained queued through Edge v121; direct HTTP acceptance
remains false. The original private environment is retained on the VPS for
rollback, permissions 0600. No provider route changed.

First real apply finished at **2026-09-24 16:45:09 UTC**: 50 checked, zero planned
repairs, zero enqueued, nine inconclusive, zero unscanned and zero errors. Cursor
advanced, lease released, nine gaps persisted, and another page remains. CLI exit
2 correctly denotes partial coverage. This later batch differs from the earlier
read-only preview; it is not evidence of nine lost receipts or nine repairs.

Validation: 194 focused unit tests passed; SQL recovery integration passed;
independent review approved tenant fencing, trusted provenance, exact ID/chat
matching, quote suppression and existing-group repair. Deno and changed-file
ESLint passed. Type ratchet introduced zero errors; frontend production build
passed. The full unit run before the final defensive tests had 13,813 passing,
151 failing and 154 skipped: the same 158 failure headings as the pre-existing
baseline. The repository-wide suite is not green. Changed vault documents and
indexes passed their checks; unrelated global vault debt remains outside scope.


### Automatic cycle verified — 2026-09-24 16:49 UTC

The first unattended cycle finished at 16:49:34 UTC: 50 checked, 11 planned and
11 enqueued read-state repairs, eight inconclusive, zero errors/unscanned. Inbox
readback confirmed all 11 synthetic events completed/processed in one attempt
with no errors. An exact organization/instance/message/chat/direction join found
all 11 targets at the recovered read state. No WhatsApp message was sent.

Across the first two pages: 100 checked, 11 confirmed repairs and 17 retained
inconclusive cases. This is a partial seven-day scan, not universal replay.
A bounded read-only diagnosis of the initial nine gaps found seven provider
statuses outside the accepted contract and two chat mismatches, with no missing
provider results or HTTP/parse failures. Temporary diagnostic container and files
were removed. The difference from the earlier seven-case preview has no proven
cause because identical row/time coverage was not established.

Worker sample: zero restarts, 0.64% CPU and 68.35MiB/512MiB memory. It is not a
peak test. Gate remains queued, worker unpaused/revision4, provider URL unchanged,
direct acceptance false. This recovery release saves zero Edge invocations.

Implementation merged via PR #2178 as `d28871396`. Final focused coverage is
198 tests plus three SQL integrations. GitHub Actions did not start: its current
check annotation reports failed account payments or spending-limit exhaustion.
Local results and independent review are evidence; CI is not reported green.
