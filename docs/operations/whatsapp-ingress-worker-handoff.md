# WhatsApp ingress worker pause and reconciliation

This controls worker claims only. It is not an Edge/provider routing switch and
never proves that an older Edge isolate stopped writing business data.

## Database contract

Migration `20271021000032_whatsapp_ingress_worker_pause.sql` adds private
`whatsapp_ingress_worker_control` state and two service-only RPCs:

- `set_whatsapp_ingress_worker_pause(organization, instance, paused, expected_revision)`
  returns the new revision. Missing row means unpaused/revision zero. Pause and
  claim serialize through the same per-instance advisory transaction lock.
  Tenant scope stays locked through the mutation. A stale revision or an instance
  reassigned away from its control organization rejects the operation.
- `get_whatsapp_ingress_handoff_snapshot(organization, instance)` returns pause,
  revision and counts only. `processing_count` means unexpired processing leases;
  `expired_count` means expired/null processing leases. Neither count establishes
  whether the old process still runs. No message payload or credential is returned.

Pause commits before future claims are blocked. Already claimed work can finish;
admission/enqueue remains enabled. Resume refuses any `processing` row, including
expired leases, and requires the current revision. It does not discard failures.

The earliest `dead_letter` event now blocks later events **in that instance**.
Other instances continue. This prevents a failed pin/reaction being replayed after
newer state merely because its retry budget ran out. Inspect and reconcile the
failure; never delete it or mark it complete only to make the queue look empty.
No automatic replay or terminal-event reset is included.

## Operator command

Use `node scripts/whatsapp-ingress-handoff.mjs` with a private, caller-owned 0600
JSON file containing `supabase_url` (HTTPS project origin) and `service_role_key`.
The command rejects symlinks, unsafe permissions and non-Supabase origins. Do not
put keys in command arguments, documentation, source control or chat.

```sh
node scripts/whatsapp-ingress-handoff.mjs snapshot --credentials-file /private/credentials.json --organization ORGANIZATION_UUID --instance INSTANCE_UUID
node scripts/whatsapp-ingress-handoff.mjs pause --credentials-file /private/credentials.json --organization ORGANIZATION_UUID --instance INSTANCE_UUID --expected-revision 0
```

Use the actual current revision from snapshot; zero above is only an example.
Each change makes one mutation request followed by a readback. Network timeout,
HTTP error, unexpected response or changed revision produces failure without a
retry. The first write might have committed: inspect a fresh snapshot before
issuing another command. Readback confirms one observation, not future ownership.

Pausar não é drenar: uma pausa impede o worker de buscar novos eventos. Trabalho
já em execução pode terminar, e novos eventos continuam sendo guardados. Para
retomar após confirmar término/reconciliação do trabalho antigo:

```sh
node scripts/whatsapp-ingress-handoff.mjs resume --credentials-file /private/credentials.json --organization ORGANIZATION_UUID --instance INSTANCE_UUID --expected-revision CURRENT_REVISION
```

The CLI does not stop/start containers, modify provider callbacks, change Edge
flags, repair a dead letter or authorize business replay. `/ready` retains its
admission-liveness meaning; it can be healthy while claims are paused/blocked.
Turning readiness off for pause would reject requests before durable admission.

Keep pauses bounded. Inspect existing `whatsapp_ingress_budget` counters and
oldest pending timestamp separately: the whole inbox is capped at 20,000 rows and
64 MiB of payload, including retained completed events. This CLI adds no periodic
queries or monitoring service. Do not leave an unobserved paused queue growing.

## Activation boundaries and rollback

Before migrating effects, separately prove that legacy Edge work is quiescent,
that one worker owns execution and that events failing before enqueue can be
recovered. A database claim pause does not fence business writes from an old
process and does not solve provider redelivery or cross-route event ordering.
Direct provider traffic remains unchanged by this implementation.

The manual migration rollback file locks the inbox/control tables and refuses
any noncompleted event or any control row. On an eligible empty-control database
it restores the previous claim definition and revokes the new pause RPC from
service_role, retaining tables, rows and snapshots. It intentionally refuses to
remove an active pause behind the operator's back. An applied rollback is not a
reason to rerun the original migration blindly; use a reviewed forward repair.

## Validation scope

PGlite tests execute actual migration/rollback SQL, roles and permissions:
positive service access, denied user access, wrong tenant, reassignment, stale
revision, pause with ongoing work, continued enqueue/finish, expired leases,
dead-letter barriers, another instance progressing, and guarded rollback.
Local tests do not establish multi-session lock scheduling or provider delivery.
CLI tests use real private files and HTTP stubs, verifying secret redaction,
validation, scoped arguments, no retry and readback. No production route, Edge
flag or active worker is changed by these tests.


## Production readback — 2026-09-24

Applied to `jsjsmuncfkbsbzqzqhfq` under actual ledger version
`20260924143904_whatsapp_ingress_worker_pause`. Source filename prefix is
`20271021000032`; do not reapply because the historical timestamp differs.
Baseline immediately before apply: zero inbox rows/bytes, no control table and
no prior ledger entry with this name. Existing claim definition matched SQL29;
its restoration and refusal conditions were tested locally before applying.

A rollback-only transaction executed as `service_role` on the pilot confirmed
snapshot, pause, stale-revision rejection, wrong-tenant rejection, enqueue while
paused, no claim while paused, resume, claim, refusal to resume with processing,
and finish while paused followed by resume. The transaction rolled back all
probe events and control changes; no business handler or WhatsApp send ran.

Final readback: inbox rows=0, budget rows/bytes=0, control rows=0. TorqueSDR
snapshot: paused=false, revision=0 and every event count=0. RLS enabled;
`anon`/`authenticated` have no table SELECT or RPC EXECUTE; `service_role` has
RPC EXECUTE and table SELECT, but no direct INSERT/UPDATE/DELETE. All three
control/claim functions have empty search_path. No provider route, Edge flag or
worker deployment changed, and no temporary Supabase branch was created.

Validation: 20 CLI tests plus migration naming/contract checks (71 tests in
three focused suites), and two SQL integration tests passed. Build and TypeScript
ratchet passed. Full unit run found two naming-collision failures, fixed by the
new `00032` prefix; both guards passed in the focused rerun. The remaining 151
failure headings matched the prior baseline. Lint retained the same five existing
quote warning entries; no baseline was changed. Independent GPT-6 Sol review
covered SQL, rollback, CLI, tenant locks and credential handling.


## Edge execution gate — staged protocol, 2026-09-24

SQL33 adds an explicit per-instance mode (`inline` or `queued`) and metadata-only
execution tickets. It does not initialize any instance. The Edge allowlist
`WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS` is empty by default and independent of the
older inbox flag. A listed instance requires initialized database state; errors
must reject admission rather than silently return to inline execution.

`begin_whatsapp_edge_execution` uses the same per-instance advisory lock as
worker claim and mode changes. In inline mode it registers a ticket before
business effects; in queued mode it commits the full event to the existing inbox
before returning success. Existing noncompleted inbox work prevents new inline
admission. Only authenticated, database-resolved `messages_update` events enter
this protocol. Explicitly disabled group capture retains the shared exclusion.

Closing inline admission does not wait for existing tickets: it switches to
queued admission immediately. Claims wait until every ticket settles. Successful
business processing settles the ticket; HTTP timeout, rejected processing or an
uncertain completion RPC cannot establish quiescence. There is no TTL that
silently releases ownership. Tickets carry no payload and are capped per
instance. Investigate retained tickets; never clear them only to unblock traffic.
Instrumented inline updates use strict target checks: a missing target (including
an out-of-order update) returns failure and retains its ticket. This can block
the pilot indefinitely until reconciled. Do not enable unattended or assume the
legacy handler's ignored-update behavior persists under instrumentation.

The completion belongs to the actual processing promise, including completion
that happens after the HTTP timeout. Runtime logging and response delivery do
not own ticket lifetime. Reopening inline admission requires no tickets and no
pending, processing or dead-letter inbox work. Existing worker pause and FIFO
barriers remain independent requirements. Instances without a registered gate
retain the previous claim contract.

This protocol covers instrumented code only. A zero ticket count cannot prove
that an older, uninstrumented Edge isolate stopped. Enabling the allowlist,
changing a secret or reading back a new deployment does not supply that proof.
Direct enqueue arriving after reopening also blocks new inline admission; this
is not an automatic cross-route reconciliation mechanism.

The temporary inline stage adds two RPC calls per successful update (begin and
complete). It is a handoff safeguard, not an invocation saving. The Edge-to-inbox
stage still invokes Edge for every request. Count savings only after verified
direct ingress activation and a representative observation window.

## Provider recovery boundary

The reviewed Uazapi 2.4.2 [guides](https://docs.uazapi.com/llms-full.txt) and
[OpenAPI](https://docs.uazapi.com/openapi-bundled.json) do not define a durable
failed-webhook replay contract. The error endpoints retain only the latest 20
failures in memory and lose them on provider restart. Message lookup has a
seven-day local retention window; it is not a complete event journal.

Inference: error capture and receipt-state reconciliation can reduce gaps, but
cannot prove recovery of every reaction/pin update lost before our inbox commit.
The short earlier probe concerned `messages`, not every `messages_update` shape;
its lack of observed retries is not proof that the provider never retries.

Before claiming full recovery, obtain the provider's delivery contract for this
server: retryable response codes and network failures, attempt/time limits,
persistence across restarts, ordered event identity, and replay coverage for
receipts, reactions and pins. No support message was sent and no automatic replay
of captured payloads was introduced. Error payloads may contain provider tokens.


## SQL33 production readback — 2026-09-24

Applied source `20271021000033_whatsapp_edge_execution_gate.sql` to
`jsjsmuncfkbsbzqzqhfq`; actual ledger version is
`20260924151218_whatsapp_edge_execution_gate`. Do not reapply based on the source
prefix. Baseline: zero inbox/control rows, no gate table or gate ledger entry;
existing claim body matched SQL32 and the tested rollback restoration.

After apply, a rollback-only transaction as `service_role` exercised inline
initialization, stale revision and wrong tenant rejection, ticket creation,
closing admission with a ticket alive, durable queue admission, blocked claim,
refused early reopening, ticket completion, claim/finish and drained reopening.
No business handler or external message ran. Readback after rollback: zero gate,
ticket, inbox and worker-control rows. New tables have RLS, no user SELECT and no
service-role direct writes. All four RPCs deny anon/authenticated, allow service
role and have empty search_path. No Edge deployment/allowlist/provider route or
worker activation occurred; no temporary Supabase branch was created.

Validation: 140 focused unit tests (including migration naming) and three actual
SQL/PGlite integration tests passed, including guarded rollback execution. Build,
Deno check and TypeScript ratchet passed. Full unit run reported 152 failures;
the explicit-false strict-target regression was corrected and passed in the final
focused run. The remaining 151 failure headings match the prior baseline. Lint
still reports the same five existing quote warnings, outside this diff. No
baseline was changed. Independent GPT-6 Sol review approved the final default-off
scope after fixing rollback locking. PGlite does not prove multi-session lock
scheduling; production smoke proves transactional behavior, not a live handoff.


## Follow-up: live parity and activation scope

Version119 now uses canonical update processing with permissive missing-target
policy; execution instrumentation remains unactivated. See
`whatsapp-live-update-parity-2026-09-24.md` for actual deploy evidence and the
remaining strict-worker liveness issue. Provider retry uncertainty remains a
residual risk for a same-URL Edge-to-inbox pilot, not an absolute block on that
stage; direct VPS routing is a separate cutover with new failure modes.
