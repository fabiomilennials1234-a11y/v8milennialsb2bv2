# Same-URL WhatsApp Edge → inbox pilot

Scope: one database instance, `messages_update` only. Provider URL stays on the
existing Supabase Edge webhook. The Edge function authenticates and resolves the
instance, then uses the database execution gate. A queued response acknowledges
only after inbox commit. One existing VPS worker claims queued events. This pilot
does not measure the savings from direct provider → VPS ingress.

## Offline release artifact

`node scripts/prepare-whatsapp-execution-bridge.mjs <verified-v119-functions-dir> <new-empty-output-dir>`
builds a verified patch bundle without contacting Supabase or Uazapi. It
requires the verified 56-file v119 manifest and exact hashes of every input,
then changes only the live webhook monolith and shared receipt processor and
adds the Edge bridge and shared inbox module. Review
`execution-bridge-manifest.json` and the four-file diff before deploying. The
extracted v119 bundle omits three unchanged type-only imports. Overlay the
verified patch onto a complete dependency tree for typecheck; deploy the exact
58-file baseline-plus-patch bundle as prior v119 deployment did. The new code
starts with the pilot flags off. Never
replace the monolith with the current repository handler: v119 contains
unrelated production behavior.

The live patch adds admission after path-secret authentication and tenant-bound
instance resolution. It associates ticket completion with the business promise
before the HTTP timeout races. A late successful completion can settle its
ticket; failure or uncertain settlement retains it. Pure receipts absent from
local message history keep v119's permissive behavior. Edits, deletes, pin and
reaction operations require their targets for instrumented inline execution.

## Bounded activation

Record start/end UTC times and actual deployment identifier in the private
operation log. Public notes should contain only counts, revisions, status codes
and redacted instance labels; never provider payloads, webhook URL secrets,
service-role keys or ticket IDs.

1. Prove one VPS worker identity and health. Record current inbox budget,
   gate/ticket/worker-control counts and oldest unresolved event for the pilot
   instance. Confirm no other pilot route, replay or worker owns its effects.
2. Deploy the verified default-off bundle. Probe health and one non-pilot path.
   Its flags remain off. If deployment fails, stop here.
3. Initialize the pilot gate as `inline` with expected revision `0`. Scope by
   organization and database instance UUID. Read back revision `1`, zero tickets
   and zero noncompleted inbox events. Turn on only the pilot execution allowlist
   for that instance. Do not use the older direct-inbox allowlist concurrently.
4. Observe the instrumented inline stage for a bounded window. Allow at least
   400 seconds of official wall-clock time from confirmed deployment, then
   check for old requests and database work still in flight.
   A clock interval alone is not proof of quiescence; in-flight writes may outlive
   an HTTP response. Retained tickets require reconciliation before cutover.
5. Switch gate `inline` → `queued` by current revision. This atomically closes
   inline admission. Existing tickets may finish; the worker cannot claim until
   all tickets are gone. Read back mode/revision and zero tickets. Activate only
   the already prepared single worker after proving its claim path and canonical
   receipt handling. No provider URL change.
6. Watch a bounded observation window: Edge 2xx/503 counts, new inbox commits,
   pending/processing/expired/dead-letter counts, oldest event age, worker
   claims/completions, provider-reported webhook failures and representative
   receipt/pin/reaction results. Stop expansion on any unexplained divergence.

The gate has no ticket TTL. A stale ticket is evidence of uncertain inline work,
not a timer to bypass. A regular dead letter blocks that instance. A pure
receipt waiting for a message target is retried in a separate 10-second lane for
at most five minutes; it does not hold later regular updates. Its terminal
unmatched outcome remains audited. A deferred dead letter does not block regular
work, but still requires investigation. An active processing lease in either
lane blocks claims from both lanes.
The inbox has a global row/byte cap; a paused worker can fill it. The official
Uazapi [`messages_update` contract](https://docs.uazapi.com/webhook/messages_update)
states that its worker does not automatically repeat a failed HTTP delivery.
The [webhook guide](https://docs.uazapi.com/docs/integrations-webhooks) warns that
slow or broken destinations can delay and even lose events at volume. No
status-specific recovery guarantee exists for 408, 429, 500, 503 or timeout;
the [generic retry advice](https://docs.uazapi.com/docs/errors-and-retries)
addresses API callers, not the webhook sender. The
[`/webhook/errors` diagnostic](https://docs.uazapi.com/endpoint/get/webhook~errors)
retains only 20 failures in memory and loses them on provider restart. It is
not durable replay. A failed admission before the inbox commit can therefore
lose the event. This bounded same-URL pilot adds no provider route and may
proceed with that existing residual risk observed; it does not save Edge
invocations or prove direct-VPS ingress safe.

For a direct provider → VPS route, require either a written provider guarantee
specific to `messages_update` failures or a tested reconciliation path from
authoritative provider state before claiming recovery. Message state lookup may
repair some missing receipts, but cannot be presumed to reconstruct each pin,
reaction or transition event or its original order. Test 408, 429, 500, 503,
connection refusal and timeout on a controlled instance and compare provider
state with durable inbox records; an observed retry in one test is not a lasting
contract. The [webhook configuration API](https://docs.uazapi.com/endpoint/post/webhook)
documents multiple destinations by ID and event list, but duplicate-free route
transition and recovery still need controlled proof.

## Rollback while queued

Keep the execution allowlist and instrumented Edge bundle active while any
noncompleted event or ticket exists. Turning the flag off or reverting the
bundle before drain would allow inline effects to overtake queued work.

For a worker failure, pause claims using the worker-control revision, preserve
the inbox and tickets, repair or replace the sole worker, then resume after
reconciling processing leases. For a deliberate return to inline: stop new
provider deliveries if an authorized control exists, drain/reconcile every
pending, processing, expired and dead-letter event, confirm zero tickets, then
switch `queued` → `inline` with the current revision. Verify readback before
removing the execution allowlist or restoring prior Edge code. If arrivals keep
the queue nonempty, maintain queued admission and resolve the worker; do not
force the mode change. Keep the one-instance pilot bounded until evidence is
recorded. No automatic deletion or marking work complete to make counters zero.

## Production preparation observed 2026-09-24

- SQL34 applied with CTO session authorization; actual Supabase ledger
  `20260924155231` differs from repository version `20271021000034`.
  RPC readback: anon/authenticated denied, service role allowed. No ephemeral
  branch was created; four PGlite integrations cover migration, pause, gate,
  receipt lanes and rollback.
- Narrow 58-file bundle deployed as webhook v120 at 15:56:25 UTC. Readback
  byte-matched every file; only the two documented v119 files changed, two added.
  Setting the one-instance execution allowlist generated v121 at 15:56:53 UTC;
  its 58 files also byte-matched the artifact. No legacy inbox flag is present.
- Pilot gate initialized `inline` revision1, worker pause revision1. One
  localhost-only VPS container `torque-ingress-pilot`, image
  `torque-whatsapp-ingress:pilot-c2440155`, has HTTP admission disabled, read-only
  filesystem, nonroot user, bounded CPU/memory and zero observed restarts.
  Provider configuration remains unchanged.
- Exact live bundle passed offline behavioral smoke (default off, pure receipt
  inline settlement, strict mutation failure, queued admission without effects,
  late settlement after HTTP timeout). Targeted units149/149; full suite
  13,780 passed,151 known failures: failure-heading set identical to prior v119
  validation. Build and type ratchet pass. Lint reports the same five existing
  quote-related warnings, no new changed-file warnings.
- The v120 unauthenticated OPTIONS probe returned405, preserving the original
  monolith's method behavior; it was not counted as a successful health check.
  Initial real POST callbacks across v120/v121 returned200.

This section records preparation only; queued activation and its readback must
be recorded separately before calling the pilot active.

## Same-URL pilot activated — 2026-09-24 16:04 UTC

At activation, more than400s had elapsed since the last observed v120 request
(15:56:52 UTC); old v119 last appeared at15:56:29. The closed log window through
16:02:34 contained136 v121 POST callbacks, all200. No tickets, unresolved inbox
rows or active database queries older than400s were observed. This is bounded
operational evidence, not a claim of globally atomic deployment.

TorqueSDR execution gate changed to `queued`, revision2; worker pause changed
to false, revision2. HTTP admission on the VPS remains disabled/localhost-only,
and provider URL/configuration are unchanged. A controlled duplicate receipt
for an outgoing message already marked read returned200 `{accepted:true}`.
Its inbox row completed as `processed` in1.836211s, one attempt, zero deferrals,
no error. No WhatsApp message was sent. Container readback: running, zero restarts.

The pilot is now active only for this instance's `messages_update`; messages,
other events and all other instances retain existing handling. Each callback
still invokes Supabase Edge, so realized invocation savings from this activation
remain zero. Direct provider→VPS migration is not active. Retain gate/allowlist
until any accepted queue work is drained; follow the rollback above.
