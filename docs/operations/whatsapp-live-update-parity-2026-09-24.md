# WhatsApp live update parity — 2026-09-24

## Delivered and active

Published webhook version119 from live version118 with a narrow patch. All55
baseline files were compared byte-for-byte with the current remote bundle before
preparation and again immediately before deploy. Readback verified all56 deployed
files exactly.53 previous files are unchanged; index and quote presentation helper
changed, and canonical `message-update.ts` was added. No route, flag, worker or
schema activation was performed.

The live messages_update handler now delegates to the same canonical processor
used by the worker. Receipt UPDATE uses an atomic predecessor-state condition,
so late delivered/sent cannot replace read. Single-reaction replay no longer
increments count repeatedly; CAS protects competing writes. Delete/pin replay
keeps the first stored timestamp. Reads/writes constrain organization and instance.
Real persistence errors propagate instead of returning success. Duplicate receipts
can finish interrupted quote acceptance; first acceptance remains immutable.
V2 normalization preserves vendor fields for pin/reaction/edit/delete handling.

Missing historical/external message targets remain permissive in this live path
(`requireTarget=false`). The private execution-gate allowlist remains disabled.
This deployment does not contain the whole main handler, activate execution
tracking or establish an exclusive worker owner. It fixes an incompatible legacy
writer before that later step. No new invocation savings are attributed to it.

## Evidence

- Offline builder pins baseline index/quote SHA256 and canonical source hashes;
  refuses drift, symlinks and existing output. Manifest records every output hash.
- 89 focused tests passed: builder, canonical update logic and real SQL replay.
- 16 tests imported the actual prepared live entrypoint: monotonic status,
  duplicate reactions, persisted failure responses, V2 pin, tenant filters,
  missing history, incoming receipts, auth and existing group-capture behavior.
- Full unit:13,766 passed,151 failed,154 skipped. All failure headings match the
  prior baseline; no new failure. Build and TypeScript ratchet passed. New-file
  ESLint passed; full lint retains the same five quote warnings outside this diff.
- Deno check of canonical module passed. Downloaded live bundle omits three
  type-only source dependencies, so standalone full-bundle Deno check cannot be
  claimed; these omissions existed before the patch. Actual prepared bundle tests
  and hosted deployment succeeded.
- Independent GPT-6 Sol review found no blocker. Custom webhook authentication
  preserved; unauthenticated production probe returned404 without a business send.
- First observation15:28:28–15:29:11UTC:13 messages and20 messages_update successes,
  no uazapi_process_error rows. Short aggregate window may contain old isolates;
  it is not attribution by deployment version or long-term stability evidence.

Baseline immediately before deployment:10-minute window ending15:26:34UTC had
385 messages and224 messages_update successes,13 unmatched receipts and no
uazapi_process_error rows. These are application logs, not billable-invocation
counts or a complete delivery ledger.

## Reproduce offline validation

Retrieve and privately verify a matching baseline bundle first. Builder does not
retrieve credentials, call provider APIs or deploy. Use a new scratch directory:

```sh
mkdir /tmp/torque-parity-smoke
node scripts/prepare-whatsapp-update-parity.mjs /path/to/baseline/functions /tmp/torque-parity-smoke/functions
cp tests/fixtures/whatsapp-live-update-parity/*.test.ts /tmp/torque-parity-smoke/
TORQUE_LIVE_PARITY_SMOKE_ROOT=/tmp/torque-parity-smoke npx vitest run --config tests/fixtures/whatsapp-live-update-parity/vitest.config.ts
TORQUE_LIVE_BUNDLE_TEST_DIR=/path/to/baseline/functions npx vitest run tests/unit/whatsapp-live-update-parity.test.ts
```

The script is pinned to this verified historical baseline, not a generic patcher
for future deployments. Output manifest is excluded from deployed function files.
Rollback artifact is the unchanged55-file baseline retained locally at
`/tmp/torque-ingress-live-group-fix/functions`; redeploy only after checking current
version and any intervening work. Rollback restores code, not historical statuses.

## Remaining path to activation

1. Resolve queue liveness for unmatched receipt-only events. TorqueSDR had538
   successful update records and7 unmatched receipt records in the24-hour window
   sampled15:27UTC. They are counts of log records, not distinct billable calls.
   Strict worker handling can dead-letter a legitimate external receipt and block
   FIFO. Define a bounded wait for out-of-order arrival and an auditable terminal
   policy; absent pin/reaction/edit/delete targets must retain reconciliation.
2. Stage the execution bridge into the live bundle, preserve the same provider
   URL, initialize pilot state and observe version retirement plus active tickets.
   Hosted paid workers have a400s wall-clock cap; a12s HTTP timeout is not drain.
   Deployment acknowledgement alone is not proof of global route retirement.
3. Start one worker for the pilot after ownership conditions hold. Verify queue
   delay, ACK errors, attempts, dead letters and drain/rollback. Bound admission
   to existing20,000-row/64MiB limits; do not activate an unobserved backlog.
4. Move callbacks directly only after handling added endpoint/cutover failure
   modes. Then measure real Edge usage across both organization projects, add
   growth margin and revisit other consumers. Edge-to-inbox still costs one Edge
   invocation per callback, so neither this patch nor that intermediate stage
   proves the1.4M monthly target.

### Scope correction: provider recovery

Uazapi's undocumented precommit retry is an existing residual risk for the same
Edge URL and database. It is **not an absolute prerequisite** to a controlled
same-route Edge-to-inbox pilot: durable commit improves postcommit recovery.
New queue rejection/capacity failures must still be measured and bounded. Direct
VPS cutover adds a different endpoint and route transition, so recovery must be
resolved for that later stage. No claim of guaranteed zero loss is made.

Sources reviewed: [Supabase limits](https://supabase.com/docs/guides/functions/limits),
[background tasks](https://supabase.com/docs/guides/functions/background-tasks),
[Uazapi contract](https://docs.uazapi.com/openapi-bundled.json).
