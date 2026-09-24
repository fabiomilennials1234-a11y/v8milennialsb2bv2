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

1. **Stable queue and operational response.** The earlier FileDownloaded barrier
   was repaired and drained. A new dead-letter head appeared by 20:17 UTC;
   resolve it before routing changes. Continue checking natural
   traffic and queue health rather than only process liveness. Unknown future
   event shapes remain a compatibility risk.
2. **Public HTTPS ingress and failure rehearsal.** DNS, certificate and a
   separate Traefik route are ready, but the new event-router image has not been
   deployed and direct admission remains off. Validate authenticated requests,
   path rewriting, payload limits, commit before ACK, restart, database outage,
   TLS failure and host/network outage against the public route. Accepted inbox
   work survives a process restart; an event that never reaches the commit may
   still be lost.
3. **Single-route provider transition and ownership.** Enable the protected
   instance barrier in every route writer and let previous executions finish.
   Verify the full local/global configuration and the Edge execution gate. Then
   update the URL of the *existing* webhook ID once, preserving its events,
   filters and URL-suffix flags; verify exact readback and live delivery. The
   opt-in router must forward `messages` and `connection` to the fixed Edge
   origin and durably enqueue `messages_update`. Rollback restores the original
   URL on that same ID while the queued worker drains. An automatic fallback
   after an ambiguous commit could duplicate or reorder effects; do not add one.
4. **Pre-commit availability and honest coverage.** Uazapi documents no
   automatic retry for failed `messages_update` HTTP delivery. This risk also
   exists on the current Edge route; an unattainable zero-loss proof is not an
   absolute veto on a bounded pilot. Test the new VPS/proxy failure surface,
   monitor provider errors and queue health, and retain a fast manual route
   rollback. Receipt reconciliation recovers only confirmed delivered/read
   state for known outgoing messages; it cannot reconstruct lost edits,
   deletions, reactions, pins or operation order. Do not describe that partial
   recovery as replay or guaranteed delivery.

Direct routing must not be reported enabled merely because the worker runs or
SQL migrations pass. Start any eligible cutover with TorqueSDR only, compare
outcomes and observed invocation rate, then consider expansion. No fixed
activation date or 1.4M monthly guarantee is established by this incident fix.
The same-URL Edge → inbox path still consumes an Edge invocation per callback.

## Public ingress prepared; provider route unchanged

`ingress.torquecrm.com.br` has DNS A `46.202.148.241` with TTL 300 seconds.
The real TLS certificate was issued on 2026-09-24 and expires on 2026-12-23.
Traefik loads the independent file-provider configuration
`services/whatsapp-ingress/deploy/traefik.yaml`; EasyPanel's generated main
configuration is untouched. The EasyPanel network overlay must retain alias
`torque-whatsapp-ingress` whenever the container is recreated, or the Traefik
upstream name will stop resolving. Access logs are disabled for this route so
secret-bearing webhook URLs are not recorded.

Initial public probes reached `/health` 200 and `/worker-health` 200. `/ready`
remained 503 because direct admission flags are off. At the later 20:17 UTC
snapshot, `/worker-health` returned 503 with reason `dead_letter`; the original
healthy probe is historical, not current queue status. These probes establish
TLS and reachability, not supplier delivery or durable admission. The new opt-in
`services/whatsapp-ingress/event-router.ts` is prepared in code: after canonical
authentication and tenant resolution, it forwards only `messages` and
`connection` to the fixed Supabase Edge origin; `messages_update` goes to the
existing durable inbox. Unknown events fail closed. `INGRESS_FORWARD_LEGACY_EVENTS`
defaults to false. This new image and the supplier URL change are **not deployed
or enabled** at this checkpoint. The protected-instance environment was saved at
20:17:39 UTC for the pilot UUID only and its presence digest was checked. A real
rebind probe returned 401, which does **not** demonstrate the expected 409 guard;
no provider configuration change was confirmed. Verify the live writer guard
before attempting any cutover.

Queue snapshot at 20:17 UTC: 204 completed, 40 pending, one dead letter, zero
processing, zero expired leases; claim control unpaused at revision 6. The new
head is an observed `FileDownloaded` envelope with `IsFromMe=false` and no
business mutation fields; its exact scoped message already has a media URL.
SQL37 and a matching TypeScript rule are being prepared, not applied or deployed.
No current drain or green queue may be claimed.

Before the one-route cutover, test the event router's exact path/response
handling and provider readback, confirm old Edge inline tickets have settled,
exercise a committed update through the public URL, and run a bounded outage
and rollback rehearsal. The VPS becomes an availability dependency for all
three configured event types, including those forwarded to Edge. A 503, timeout
or host outage before commit can lose a supplier callback; `/webhook/errors` is
diagnostic, not a durable replay source. Report savings from measured Edge
invocations after live cutover only. The 1.4M monthly target remains a projection.

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
