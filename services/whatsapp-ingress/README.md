# Dedicated WhatsApp ingress — disabled by default

Candidate runtime, not a production routing change. The service imports the same
`supabase/functions/whatsapp-webhook/handler.ts` used by the Edge entry point.
Instance resolution, authentication, tenant scope, message persistence, media,
triggers and Copilot remain canonical code. No event is forwarded to the Edge
webhook as an intermediate hop.

## Admission and acknowledgment

- `INGRESS_ENABLED` defaults to false. `/health` stays 200 while `/ready` and
  webhook admission return 503. Enabling requires database instance UUIDs in
  `INGRESS_INSTANCE_IDS` plus explicit credentials and network destinations.
- The allowlist evaluates the **database-resolved instance ID**, after secret
  authentication. A payload or URL cannot self-authorize its instance. Unknown
  instances receive 503 in the scoped service instead of a successful drop.
- Requests use the existing `/whatsapp-webhook/<secret>[/instance][/event]` or
  `/functions/v1/whatsapp-webhook/<secret>[/instance][/event]` shape. Keep secrets
  out of access logs; configure the reverse proxy to redact these paths.
- Initial canary accepts **only `messages_update`**. Messages, connection and
  other events return 503; provider routing must separate event types first.
- Authentication and database tenant resolution precede durable admission.
  The service returns **200 only after the enqueue RPC commits**, preserving
  the existing Edge success status. Failed inbox
  writes return 503. Group receipts are intentionally ignored only when the
  group is positively identified and its organization's capture is explicitly
  false; policy lookup failures cannot authorize dropping events.
- Migration `20271021000029_whatsapp_ingress_durable_inbox.sql` adds a private
  service-only inbox. Every delivery gets its own event ID: payload fingerprints
  are NOT unique because pin → unpin → pin can repeat identical payloads.
  This is at-least-once delivery, not exactly-once execution.
- A local worker drains durable events, invoking the canonical handler with
  strict update targets. A receipt preceding its message retries instead of
  being marked complete. Admission timestamp remains audit evidence only.
  Commercial acceptance keeps the existing time-of-verification behavior;
  never backdate from a stale receipt without persisted per-chunk evidence.
  Queue delay can require reconfirmation: validate or exclude organizations
  with live quotes before canary routing.
- Claims serialize per instance, preserve FIFO (including backoff), and issue
  fenced lease tokens. One event per instance can be active. A lease expires
  after 120 seconds; failures use exponential backoff, at most eight attempts,
  then remain visible in `dead_letter`. Different instances rotate fairly.
  A missing target at the head blocks later events for that instance during
  backoff. Monitor oldest pending age and canary latency; this design does not
  promise zero delay. Do not bypass FIFO to conceal a stuck receipt.
- Each event waits for its own tracked background promises before completion.
  If the event exceeds 45 seconds the process exits with its lease retained;
  it never releases the lease while its old handler is still running. A lost
  completion write also leaves the lease recoverable. Persisted effects must
  remain replay-safe because a process can die after effects but before finish.
- Canary requires `INGRESS_SINGLE_WORKER_CONFIRMED=true` and one deployed worker.
  Advisory claim locks and lease tokens do not fence already-issued downstream
  database writes. Before multiple replicas, test host kill, late database
  completion and lease recovery under contention, or add effect-level fencing.
  Do not advertise multi-replica safety from single-process unit tests.
- Global inbox admission is capped at **20,000 rows or 64 MiB of JSON payload**
  (indexes/row overhead are additional). An atomic private counter prevents
  concurrent admissions overshooting without scanning the inbox. Full inbox returns 503; accepted work is never
  evicted. Every minute the worker deletes at most 500 completed events older
  than two days. Pending/dead-letter events are retained for investigation.
  Budget applies also to retained completed rows; it can reject ingress until
  cleanup frees space. At two-day retention, 20,000 rows allow roughly 10,000
  deliveries/day in steady state: a deliberate small-canary limit, not full
  cutover capacity. Monitor oldest pending age, dead letters and disk.
  Explicit deletion of an instance/organization cascades its technical inbox
  and decrements the counter, preserving the existing deletion flow; this is
  intentional user deletion, not an automatic discard of accepted work.
- Before enabling traffic, verify provider retry/backoff
  for 408, 429, 500 and 503, plus replay of out-of-order receipts. Durable inbox
  protects events **after** successful commit; provider redelivery is still
  essential before commit, during capacity rejection or database downtime.

## Runtime limits

Actual body bytes are capped at 2 MiB even with false/missing Content-Length.
Body read deadline defaults to 10 seconds. Defaults: 32 concurrent requests,
128 tracked background tasks, 45-second graceful drain. Overload and draining
reject new events with 503 and Retry-After; existing requests and tracked
background work are drained before shutdown. A drain deadline exits nonzero
and requires reconciliation; it must not be reported as successful delivery.

Set the proxy/container stop grace period greater than the configured drain.
Keep the canary at one worker until effect-level fencing or failure tests prove
replica safety; restarts alone are not a failover strategy. Requests are never
acknowledged before durable admission to absorb overload. Memory, CPU, queue age and request latency must be measured
under peak replay before increasing limits or routing live traffic.

## Configuration and build

Required when enabled: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`UAZAPI_WEBHOOK_SECRET`, `INGRESS_INSTANCE_IDS`, `INGRESS_ALLOWED_NET`,
`INGRESS_SINGLE_WORKER_CONFIRMED=true`.
Shared handler optional environment variables retain their existing meanings.
`PORT` defaults to 8080. Service role credentials stay server-side.

`INGRESS_ACCEPTING` defaults to `true`. Set it to `false` while keeping
`INGRESS_ENABLED=true` for drain-only operation: admission and `/ready` return
503, but the worker continues processing accepted events and cleanup. Use this
after restoring and verifying provider routing during rollback. Changing the
environment requires a controlled single-worker restart; claimed work remains
durable and may wait for its lease to expire. Do not start an overlapping worker
or set `INGRESS_ENABLED=false` while work still needs draining.

`INGRESS_ALLOWED_NET` is an explicit comma-separated Deno host/port allowlist.
Include the listening address, Supabase HTTPS host, and provider/media hosts
actually needed by the selected instances. Do not use unrestricted network
permissions to work around missing hosts; a missing media host should surface
in the existing retry/error paths and be fixed before rollout.

Build context is repository root:

```sh
docker build -f services/whatsapp-ingress/Dockerfile -t torque-whatsapp-ingress .
deno cache --config services/whatsapp-ingress/deno.json --frozen services/whatsapp-ingress/main.ts
```

Deno image version is pinned; SDK is mapped to the currently locked canonical
version and remote dependencies have checksums in this service's `deno.lock`.
Container runs as the non-root `deno` user. Runtime uses frozen/cached-only
modules, explicit network destinations, no filesystem/process permission
grants. Environment permission is necessary for existing shared modules; inject
only service-specific credentials. Deploy container read-only with a memory/CPU
limit and no Docker socket/host mounts.

## Checks before routing

```sh
npx vitest run tests/unit/whatsapp-ingress-runtime.test.ts tests/unit/whatsapp-ingress-handler.test.ts tests/unit/uazapi-payload-resolution.test.ts tests/unit/whatsapp-webhook-idempotency.test.ts
deno check --config services/whatsapp-ingress/deno.json services/whatsapp-ingress/config.ts services/whatsapp-ingress/runtime.ts
```

Local tests cover disabled admission, identity/authentication, original paths,
bounded input, failure status preservation, background draining and durable
inbox leases/retries/FIFO/budget/ACL in PGlite. Enqueue immediately wakes the
local worker; the two-second idle poll is recovery, not the normal receipt path.
Remote SQL fixtures test quota boundaries with a synthetic private counter;
the separate local PGlite test fills all 20,000 rows. Neither is a peak-load test.
These tests do not establish
VPS capacity, provider retries, restart survival or failover. Live routing stays
disabled until those acceptance checks pass. Rollback changes provider routing
back to the existing Edge endpoint; keep its deployment and credentials valid.
Stop new admission first, then drain/preserve accepted events. The migration
rollback refuses outstanding/dead-letter events and never drops the inbox.
Do not blindly replay terminal pin/reaction events after newer state; inspect
order and reconcile explicitly. Keep cleanup running or execute its bounded
service-only RPC if this service is disabled after the canary.


## Rollout preparation — 2026-09-24

Strict queued replay now rejects absent/partially invalid IDs, unknown operations,
and malformed operation fields before writes. Recognized no-ops remain valid.
Unknown provider shapes remain retryable/dead-letter evidence rather than being
silently completed; inspect them before increasing the canary scope.

`supabase/functions/_shared/uazapi-webhook-routes.ts` offers a pure, read-only
preflight and whole-configuration readback verifier. It preserves route IDs,
filters and unrelated routes, rejects active global webhooks and overlapping
managed events, and requires explicit complete fields. It never writes to the
provider. Existing creation/reconfigure/rebind writers still use the singleton
policy: **do not enable split routing until those writers share the routing
policy and reconciliation lock**. Two provider writes are not atomic; a passing
configuration check is not proof of gap-free or duplicate-free delivery.

No production ingress, migration or provider routing was activated by this
preparation. The current 20,000-row/two-day retention budget and serial worker
are a small-canary configuration, not capacity for all ~20,595 daily receipts
in the September 16–23 historical window.
