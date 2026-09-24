# WhatsApp ingress pilot preparation — 2026-09-24

## Actual production state

No WhatsApp traffic has moved. The existing Edge endpoint remains active.
TorqueSDR is the selected pilot (database instance
`3ea9d185-62bb-4efd-a9b4-b557938ba9e6`); its stored status was connected.
No provider routes, secrets or protected-instance allowlist changed in this step.
Additional active Edge savings: **zero**.

Migration `20271021000029_whatsapp_ingress_durable_inbox.sql` was applied to
production `jsjsmuncfkbsbzqzqhfq` with lock_timeout3s/statement_timeout30s.
Actual ledger: `20260924124643_whatsapp_ingress_durable_inbox`.
Source SHA256: `72393cc2130ad6952d86f928874279732e16123b9a580cd880b0b4067ecc1836`.
Do not reapply because the source filename and ledger timestamps differ.

Readback confirmed zero inbox rows and budget row_count0/payload_bytes0.
Both tables have RLS enabled; anon/authenticated have no SELECT, and service_role
has no direct INSERT. Enqueue, claim, finish and cleanup RPC execution is granted
to service_role, not anon/authenticated. No preview branch was created.

## Operational evidence

- Built Docker image `torque-whatsapp-ingress:1498af879` on the VPS from merged
  main `1498af87963963e3268ee97bb15021086ae0bd7d`. Only tracked service/function
  sources were staged; no private environment file was included.
- Temporary disabled container: read-only filesystem, dropped capabilities,
  no-new-privileges,512MiB,0.5CPU,128PIDs; listener bound to host loopback.
  `/health`200, `/ready`503, graceful stop exit0. Container removed and absence
  confirmed. This proves disabled startup only, not enabled runtime capacity.
- Process-restart test passed three times, final run125.02s. Actual worker/admission
  and inbox SQL run against on-disk PGlite. SIGKILL after committed fixture
  effect but before finish, clean database reopen, natural120s lease recovery,
  FIFO replay and stale-token rejection during the replacement lease passed.
  Attempts `[1,1,2]`, final fixture effects `[1,2]`, inbox attempts `[2,1]`.
  Fixture handler deliberately supports replay; canonical webhook effects,
  database crash, host failure and supplier redelivery are outside this test.
  Local test processes/files were cleaned. ESLint of new test files passed.

## Repository verification

+ Production build passed. New test files pass ESLint; independent review found
  no blocker after FIFO assertion ordering and bounded shutdown were corrected.
+ Full unit run:13,680 passed,151 failed,154 skipped; seven collection failures.
  Failure headers introduce no additions against the preceding main validation.
  The previous unrelated AST scan timeout did not recur. No baseline changed.
+ Lint ratchet still reports the exact same five warnings in untouched quote
  files as the prior main run; its raw exit is1, not a clean repository result.

## Remaining activation gates

Administrative credential configuration is unavailable through the connected
Supabase tools; the dashboard was unauthenticated. User login was requested.
Do not retrieve credentials from browser internals or log webhook URLs.

After access is restored:

1. Configure service credentials privately and validate the enabled single
   worker, representative load, receipt latency and canonical replay effects.
2. Verify supplier retry behavior for408/429/500/503 and the transition/rollback
   delivery contract. Read all local/global routes; preserve unrelated routes.
3. Enable the protected-instance guard in both live writers; allow old writer
   executions to finish before changing provider routes. Guard alone does not
   verify the split. Validate/exclude live quote acceptance for the pilot.
4. Configure TLS with secret-path logging redacted, then switch only TorqueSDR
   updates. Keep messages/connection on Edge. Verify actual delivery, queue age,
   dead letters and status UX before expanding.

Rollback restores and verifies original provider routing before disabling new
admission; keep worker/cleanup draining and writer protection until completion.
Never drop accepted events. Keep one worker; leases do not fence late downstream
writes. Current20,000-row/64MiB budget and two-day retention are pilot limits,
below the historical all-instance20,595 receipts/day. Full rollout requires
revisiting retention/capacity with measured peak and latency evidence.

## Projection, not realized savings

Historical144,166 updates in seven days imply638,449/31days across all instances.
Only actual TorqueSDR traffic removed from Edge can count as pilot savings.
With hypothetical80% idle-cron reduction and migration of every update, earlier
projection is1,514,519 calls/31days:114,519 above the internal1.4M target.
No new reduction may be booked until traffic moves and subsequent usage is
measured. Logs are not the billing ledger; other quotas/projects remain separate.
