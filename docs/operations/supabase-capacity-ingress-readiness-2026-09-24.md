# WhatsApp ingress — readiness, 2026-09-24

> Historical readiness snapshot before the writer guard and inbox deployment.
> Current state: [pilot preparation](supabase-capacity-ingress-pilot-2026-09-24.md).

## Outcome and production state

Preparation for moving `messages_update` off Edge, not a traffic cutover.
Production still uses the existing webhook. Read-only SQL confirmed that
`public.whatsapp_ingress_events` does not exist. No migration, provider setting,
secret or live instance was changed. No temporary Supabase branch was created.
Additional active Edge savings from this increment: **zero**.

## Changes

- Strict queued receipt processing rejects absent/partially invalid IDs,
  unknown operations/statuses and malformed flags before writing. Supported
  no-ops remain supported. Failed work stays recoverable through inbox retries
  and dead-letter state. Ordinary Edge behavior remains permissive.
- HTTP200 replaces the candidate HTTP202 after successful enqueue, matching
  the existing provider-facing Edge success code. Admission failures stay
  non-2xx. Existing explicit group-capture opt-out remains a deliberate200 skip.
- `INGRESS_ACCEPTING=false` with `INGRESS_ENABLED=true` stops new admission
  while keeping the worker and cleanup running. `/health` remains200 and
  `/ready` becomes503. Use `/health` for process health, not readiness.
- Pure route preflight/parser and full readback verifier preserve opaque IDs,
  all supported fields and unrelated routes. Unknown fields/defaults, duplicate
  IDs, active global routes and overlapping managed events block planning.
  Provider URLs contain secrets; never log or serialize the returned plan.

## Activation blockers still open

1. Creation, manual reconfigure and automatic rebind still use singleton policy.
   All writers need a shared persisted split policy and reconciliation lease
   before a provider route change; otherwise automatic repair can undo it.
2. Provider add/update calls are separate operations, not an atomic transaction.
   A traffic transition needs proven handling of overlap, replay and recovery.
   Configuration readback alone does not prove event delivery.
3. Verify provider retry/backoff on rejection and preserve accepted work across
   process restart. Do not infer these properties from local function tests.
4. Validate the single-worker service under representative load and receipt
   latency. FIFO can delay one instance behind an unavailable target; inspect
   oldest pending age and dead letters separately from process readiness.
5. Current inbox retains completed deliveries for two days and admits at most
   20,000 rows/64MiB payload. This is roughly10,000 deliveries/day at steady
   state, below all-instance historical20,595/day. Do not route all instances
   into this canary budget or assume the serial worker can handle peak traffic.

## Budget

Historical seven-day sample: 144,166 `messages_update` entries, equivalent to
638,449/31days. This is potential only after that traffic actually leaves Edge.
Combining the prior hypothetical80% idle-cron savings with migration of every
update gives approximately1,514,519 Edge calls/cycle, still about114,519 above
our1.4M target. Other projects, retries, fanout and growth need separate budget.
Source: `supabase-capacity-webhook-routes-2026-09-23.json`; logs are not billing.

## Evidence

171 focused tests passed (eight suites); durable-inbox PGlite integration
passed. Deno static checks and production build passed. Full unit suite:
13,655 passed,151 failed,154 skipped; seven collection failures. Failure
headers match the preceding main validation exactly (zero introduced).
Lint ratchet reports the same five inherited quote warnings; baseline unchanged.
TypeScript ratchet result recorded in the PR.
A real local Deno process with cached/frozen dependencies started with ingress
OFF: `/health`200, `/ready`503, graceful SIGTERM exit0. This is startup evidence,
not VPS capacity, delivery or enabled-worker recovery evidence.
Independent code review found no blocking issue in this increment.

Provider contract: https://docs.uazapi.com/openapi-bundled.json (GET/POST
`/webhook`, GET `/globalwebhook`, consulted2026-09-24). The preflight has no
network effects and does not integrate into existing writers yet.


## Smallest next writer integration

Before any cutover, protect selected database instance UUIDs centrally using
an explicit allowlist in both proxy and rebind deployments. Read-before-write
alone has a race: an old writer can read the legacy route and overwrite the
new split later. A protected UUID must prohibit legacy writes independently
of the returned provider state. Verify an exact split read-only, or return a
conflict; never claim a successful reconfiguration after an inconclusive read.
Wait for old executions to finish before changing provider routes. This keeps
automatic repair disabled for the pilot and requires controlled repair/rollback;
it does not provide an atomic cutover or replace delivery/restart validation.
