# Ingress runtime validation — 2026-09-24

## Scope and production state

TorqueSDR remains on its original Edge webhook. Credentials were validated
against the configured Supabase digests without recording their values.
The original local route handles messages/messages_update/connection and excludes
wasSentByApi. Global webhook is explicitly disabled with an empty URL.
The parser now accepts this exact disabled-global shape while preserving strict
validation for active routes, instance routes, missing fields and unknown fields.

The legacy writer protection was enabled for TorqueSDR during a temporary,
additional receiver test of provider redelivery. The receiver did not alter the
primary route and retained only counts, response codes and timestamps. No events
arrived during the four-minute window: redelivery remains unverified. Its exact
route was deleted, the original inventory matched the saved JSON objects,
and the receiver container/proxy/remote credential files were removed. The
temporary writer protection was then deleted; the Supabase UI confirmed absence.
No regular ingress traffic has moved and no additional invocation savings can
be attributed to the tests.

## Real runtime evidence

Image `torque-whatsapp-ingress:1498af879` ran on the existing VPS with readonly
filesystem, dropped capabilities, no-new-privileges,512MiB/0.5CPU/128PIDs and a
loopback-only port. Production credentials and existing quote-release policy
were mirrored. Quote sending is globally false with only Hoppe allowlisted;
TorqueSDR is outside that list. No quote configuration was changed.

- Drain-only runtime: health200, ready503, graceful exit0.
- Enabled runtime: ready200 after successful database claim; invalid webhook
  secret returned404, preserving the canonical authentication contract.
- One receipt for an already-read outgoing message: durable ACK200 in181ms,
  completed in one attempt; message id/status unchanged.
- Stress profile:50 receipts at6/second, concentrated into about8seconds. All
  completed on attempt1. ACKp95=1506ms; enqueue-to-completionp95=11.679s,
  max11.725s. This is not acceptable evidence for sustained all-instance load.
- Pilot-shaped margin profile:6 initial concurrent receipts, then44 spaced1.2s
  apart (50 within about53s). All completed on attempt1. ACKp95=199ms/max362ms;
  enqueue-to-completionp95=0.881s/max1.335s.
- Both batches replayed an already-read message: representative transport and
  queue overhead, not a benchmark of every business effect or a guarantee of
  frontend rendering latency. The retained application message stayed unchanged.
- Exactly101 synthetic inbox rows were deleted only after confirmed completion,
  scoped by their test correlation and instance. Temporary containers and their
  remote credential files were removed after each test.

Fixed pre-test window2026-09-23T13:00Z–2026-09-24T13:00Z:568 successful updates
for the pilot in runtime_logs, peak3/second and25/minute. These are successful
processing records, not a billing ledger or a complete count of rejected calls.
The provider URL has no instance segment: Edge path counts are shared and must
not be attributed to TorqueSDR. The rolling-window count557 quoted during work
is superseded by this fixed window, excluding subsequent synthetic probes.

## Query and replay improvements

Durable receipt validation already reads scoped target rows. Reusing those rows
for the unmatched diagnostic removes one repeated SELECT: duplicate receipt
status handling goes from3 to2 database requests before commercial completion.
The conditional UPDATE remains mandatory; a prior snapshot cannot justify
skipping a concurrency-protected write. Quote completion still runs on replay.
Reaction updates reuse the initial snapshot but retain CAS and fresh reads after
conflicts. Permissive Edge behavior is preserved.

Five new PGlite tests run actual message-update and quote helpers with real SQL
predicates and a trigger-injected persistence failure. They prove recovery after
status persistence, sequential seal immutability, full chunk requirement, tenant
and instance isolation, superseded revision rejection and release gating. The
fixture does not establish RLS, PostgREST, simultaneous commercial confirmation
or production-schema behavior. Independent review found no blocking issue.

## Existing production error corrected

Provider diagnostics exposed8 HTTP500 deliveries with attempts1, all positively
identified as group reactions. Torque capture_groups is false. Live webhook113
looked up missing group message targets before applying that policy.

Applied only the already-merged group-reaction opt-out logic to the live bundle:
whatsapp-webhook114,55 files,54 dependencies byte-identical, custom auth unchanged.
Seven tests passed against the patched live bundle. Reread of all55 published
files matched. Unknown organization policy or failed lookup does not authorize a
skip; individual missing targets remain errors. This fixes an existing messages
path issue; it is not savings from moving messages_update.

## Remaining constraints

Do not infer guaranteed redelivery from the provider's retry advice for outgoing
API clients. The recent supplier error records showed one attempt for500;
408/429/503 and transport failures require direct verification. Official docs
also warn that delivery backlog can discard events. The local durable queue
protects committed events, not requests never received by this server.

Sources checked2026-09-24: [webhooks](https://docs.uazapi.com/docs/collections/integrations-webhooks.md),
[error diagnostics](https://docs.uazapi.com/reference/getWebhookErrors.md).

Full rollout still requires larger retention/capacity planning and measured
latency. The earlier638,449/31days estimate covers all instances in a different
seven-day window; this pilot alone cannot realize that reduction or guarantee
remaining within the internal1.4M target.

## Repository validation

- Six focused suites:168 tests passed, including five canonical SQL replay cases.
- Independent GPT-6 Sol review: no blocking finding. Security rubric: tenant and
  instance predicates, conditional writes, reaction CAS, release gating and
  secret handling preserved; no new schema/grants/auth surface.
- Deno check of both production source files passed. Build and TypeScript ratchet
  passed (no new TypeScript error).
- Full unit run:13,695 passed,152 failed,154 skipped. Failure headings matched
  the preceding baseline run except an existing AST guard exceeding its5s limit
  under concurrent validation. That guard passed alone in1.76s. This is not a
  fully green repository suite.
- Lint ratchet output was byte-identical to the preceding baseline run: five
  existing warnings in quote files untouched by this patch. Baselines unchanged.

## Transient production outage during final readback

From approximately13:35 to13:42:17UTC the project returned widespread REST/Auth
520/521/522/525 errors and Edge504s. Management status remained ACTIVE_HEALTHY.
SQL and authenticated REST recovered without a restart or intervention by this
work. `pg_postmaster_start_time()` then showed13:41:45.93029UTC, establishing a
database restart, but not who or what initiated it. The public provider status
page did not identify a matching incident at the time. Do not attribute a cause
to the patch, quota, capacity or provider without further evidence.

Final SQL readback13:44:54UTC: ingress row_count=0, payload_bytes=0, actual rows=0.
Authenticated REST returned200 with the same budget. The probe route was already
removed, original provider configuration verified, and the temporary writer
guard absent. No regular ingress service was activated during the incident.
