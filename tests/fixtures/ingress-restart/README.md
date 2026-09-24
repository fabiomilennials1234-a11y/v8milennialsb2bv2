# Durable worker restart rehearsal

Run from repository root with Node 22.18+ (native TypeScript stripping) and the
installed project dependencies:

```sh
node --test tests/integration/whatsapp-ingress-process-restart.test.mjs
```

Allow approximately 125 seconds. The test uses the production two-minute lease
without editing timestamps or shortening runtime timers. No credentials,
Supabase preview, external API or production data are required.

The test runs the actual `createInboxWorker`, `processInboxEvent` and
`admitReceipt` implementation. A loopback transport maps their RPC calls to the
actual migration functions in filesystem-backed PGlite. It does not replace SQL
with in-memory RPC results. Two acknowledged events enter the inbox. The first
worker commits a fixture business effect, then the harness kills it with
`SIGKILL` before completion. The database is closed and reopened from disk. A
replacement worker must wait for natural lease expiration, replay the first
event, then process the second in FIFO order. Assertions check the duplicate
effect attempt, replay-safe final state, new lease token, rejected stale
completion during the replacement lease, and both completed inbox entries.

Scope limits:

- The business handler is a deliberately replay-safe SQL fixture, **not** the
  canonical WhatsApp handler. This cannot establish replay safety of every
  production message effect.
- The worker process is killed; the database reopens cleanly. This does not
  simulate host power loss, database crash, network partition or delayed writes
  from a still-running old worker.
- RPC transport is a local adapter, not PostgREST/Supabase SDK. Production auth,
  Deno container shutdown, reverse proxy behavior and provider retries require
  separate validation.
- Exactly one worker is alive at a time. This does not prove multiple-replica
  safety, load capacity, throughput, or production latency.
- Temporary database files and child processes are cleaned in `finally` after
  pass/failure. An external termination of the test runner itself can bypass
  cleanup; its temporary directories use the `torque-ingress-restart-` prefix.
