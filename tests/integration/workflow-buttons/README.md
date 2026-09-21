# Transactional database contract test

This harness applies the candidate migration and synthetic fixtures inside **one transaction**, then rolls everything back. Run against an explicitly authorized Supabase target only. No workflow is activated, no sender/worker is called, and no WhatsApp credentials are created.

```sh
# Provide an authorized Management API token through the environment; never commit it.
SUPABASE_PROJECT_REF=<authorized-project-ref> node tests/integration/workflow-buttons/run-rollback.mjs
```

The runner also requires `SUPABASE_ACCESS_TOKEN`. It refuses to run when the candidate schema or leftover fixtures already exist. A separate query verifies cleanup after success or failure. Lock timeout is two seconds; statement timeout is twenty seconds. Existing triggers remain enabled. Synthetic organizations receive a single instance quota and are sandboxed; their workflows remain inactive. Fixture RPC calls execute as `service_role`, the same database role used by the backend.

Covers service-only grants, server-owned immutable snapshot, tenant isolation, reservation/replay, replies before acceptance, first **persisted** eligible response despite reversed processing order, single branch resolution, acceptance-based deadline, cancellation with late acceptance, and default-off feature gating.

The base suite does not prove cross-session races, durable HTTP ingress order, restart recovery, timeout processing, provider delivery, UI behavior, or live workflow routing.

Additional rollback suites:

```sh
node tests/integration/workflow-buttons/run-rollback.mjs inbox
node tests/integration/workflow-buttons/run-rollback.mjs images
node tests/integration/workflow-buttons/run-rollback.mjs failure
node tests/integration/workflow-buttons/run-rollback.mjs queue
```

`inbox` applies migrations 60+62 and verifies durable DB admission, deduplication/replay, early replies, first eligible receipt, text/media, ignored events, timeout and recovery before message persistence. `images` applies migration 61 and verifies private bucket metadata, restrictive API-only policy and denied authenticated/anonymous direct access. The Storage deletion guard may reject SQL DELETE before RLS; that denial is expected and retained synthetic metadata is checked. Both suites verify all candidate state is absent after rollback.

## Cross-session arbitration

```sh
node tests/integration/workflow-buttons/run-concurrency.mjs
```

Requires the same explicit target/token and authorization. Creates a uniquely named isolated schema with empty `LIKE` clones of dependency tables, then applies the actual migrations 60+62+63+64 with qualified namespace substitution only. No public feature tables, real tenant data, workflow activation or WhatsApp credentials are created. The schema is committed briefly so three distinct database sessions can contend; `finally` drops it and independently verifies absence.

An advisory-lock barrier confirms the first receipt is admitted while execution/question row locks remain held. A competing response and timeout resolver wait on those locks. Both button-first and free-text-first cases assert the first receipt wins after deadline, exactly one execution step, correct cursor and three distinct backend PIDs.

Limit: `LIKE` does not copy existing dependency triggers or foreign keys. Candidate migration constraints/triggers remain present; the public rollback suites separately exercise existing production dependency behavior. These probes do not prove live webhook-to-worker delivery or full workflow routing. No production deployment is implied.

`failure` verifies definitive failure routing, replay, recovery claim grace/lease/exhaustion, recovered acceptance time, reply precedence, cancellation and grants. `queue` verifies same-conversation serialization, frozen content, node-only release, single promotion, rejection of free text preceding the send and cancellation. Concurrency also exercises two simultaneous queue claimers: exactly one receives send ownership, FIFO is preserved, and the next question becomes eligible when the prior node concludes. No actual provider send occurs in these SQL probes.


Additional suites: `activation`, `history`, `admission`, `lifecycle`, `release`.
`release` applies all candidate migrations 60–68 together and runs activation, history authorization, pre-reservation failure and instance deletion contracts in one rolled-back transaction. `history` creates a synthetic auth user inside the same transaction; independent cleanup also verifies that user is absent. The final SQL result only reports the last fixture; any earlier failed assertion aborts the request.
