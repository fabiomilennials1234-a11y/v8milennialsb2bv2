# Direct WhatsApp route: incident and remaining activation gates

## Production incident found on 2026-09-24

A metadata-only inspection found one dead-letter event followed by 61 pending
TorqueSDR updates. The worker process was alive with zero restarts. The head had
failed eight times with `Message update operation unavailable` after receiving
an observed legacy Uazapi `FileDownloaded` callback at 17:01:03 UTC. The existing
canonical strict parser did not recognize it. FIFO intentionally prevented later
updates from overtaking it; process liveness did not reveal that barrier.

The event's exact scoped target was one outgoing audio message with a media URL
already present. Pending events were 30 Delivered, 30 Read and one Played at the
inspection. No conclusion about external delivery loss follows from this queue.
The partial receipt reconciler had completed 23 synthetic repairs before the
barrier; it correctly stopped admitting repairs while unresolved work existed.

## Remediation contract

The observed envelope receives `provider_notification`, not a delivered/read
receipt or a commercial effect. Recognition is limited to the exact root
EventType/type/state, observed root/event key allowlists, one nonblank message
identifier, matching Chat/chatid, IsFromMe=true and an HTTPS FileURL. Unknown or
contradictory shapes remain blocked. No FileURL is fetched; the inbox retains the
original envelope. Official provider reference consulted did not document this
subtype, so this is an observed-shape compatibility rule, not a general provider
contract. Other legacy inline instances retain their current behavior.

SQL36 revalidates the stored envelope under the completion lease and allows one
explicit replay of this subtype only. Replay requires a paused worker, queued
gate, the regular FIFO head, no processing leases or inline tickets, and exact
previous attempts/error. It preserves payload/order and records the prior
failure in a service-only audit table. A repeated ambiguous replay returns false.
No event is deleted or manually relabeled completed to make the queue empty.

`GET /worker-health` checks queue metadata independently of direct admission,
with a shared 60-second cache. Dead letters, expired leases, intentional pauses
and regular pending work older than five minutes return 503. Age includes retry
backoff: the signal means delayed service, not proof of a crashed process.
Deferred unmatched receipts retain their separate grace policy. Database errors
fail closed and responses contain no organization/instance/message identifiers.
Docker probes once per minute; unhealthy does not automatically restart the
standalone container or release a FIFO barrier. This supplies a machine-readable
health signal; it is not an external on-call notification service.

## What still prevents direct activation

1. **Stable queue and operational response.** Resolve the observed barrier,
   confirm drain and natural traffic, and monitor queue health rather than only
   process liveness. Unknown future event shapes remain a compatibility risk.
2. **Public HTTPS ingress and failure rehearsal.** The worker currently binds
   only to localhost behind no configured public route for this pilot. Validate
   TLS, authentication, payload limits, persistence before ACK, restart, database
   outage and host/network outage. The existing durable inbox protects events
   after commit, not events that never reach it.
3. **Provider transition and route ownership.** Enable the existing protected
   instance barrier in every route writer, then validate the actual provider
   transition and rollback. Two independent webhook mutations can introduce
   overlap/gaps. Payload hashes cannot deduplicate pin → unpin → pin correctly.
4. **Recovery before persistence.** Current reconciliation covers only current
   delivered/read state of known outgoing messages. It does not replay missing
   edits/deletions/reactions/pins or their original order. Provider retry/replay
   support or another tested recovery/availability design is still required;
   another receipt scan cannot close this gap.

Direct routing must not be reported enabled merely because the worker runs or
SQL migrations pass. Start any eligible cutover with TorqueSDR only, compare
outcomes and observed invocation rate, then consider expansion. No fixed
activation date or 1.4M monthly guarantee is established by this incident fix.
The same-URL Edge → inbox path still consumes an Edge invocation per callback.

## Evidence and deployment

SQL36 applied under production ledger `20260924185213`. Readback denied anon
and authenticated replay/audit access; service role can replay/read audit but
cannot update the audit directly. Stored dead-letter envelope passed the strict
SQL predicate before the one-shot replay.

Worker `notification-20260924-v2` replaced the sole container with claims paused
at revision 5. Six critical modules matched image bytes. Before replay,
`/worker-health` correctly returned `dead_letter`. Replay preserved the queue
sequence and retained eight prior `http_500` attempts in the audit. Claims resumed
at revision 6. The head completed as `provider_notification` in one new attempt;
61 previously pending updates and subsequent natural traffic drained normally.
Readback: 109 normal processed, 23 recovery processed, one provider notification,
zero noncompleted events; every current completion had one attempt. Worker and
Docker health both reported healthy, with zero restarts.

Validation: 179 focused unit tests, three SQL integrations, Deno typecheck,
changed-file ESLint, image build/readback and independent GPT-6 Sol review
passed. Tests cover unknown/mixed payload rejection, exact root/event shape,
lease fencing, wrong tenant, one-shot replay audit, rollback, cache sharing,
blocked FIFO detection and healthy worker with direct admission disabled.
No database preview branch, provider mutation or outbound WhatsApp send occurred.
Edge remains v121 with its original provider URL; direct admission stays false.

Rollback: restore the previous worker image only with the usual pause/drain
procedure; that old image cannot process a future FileDownloaded notification.
SQL rollback refuses unresolved work or retained provider-notification outcomes;
do not delete evidence or roll back the enum contract beneath accepted events.

Previous recovery evidence:
[receipt recovery](whatsapp-receipt-recovery-2026-09-24.md).
