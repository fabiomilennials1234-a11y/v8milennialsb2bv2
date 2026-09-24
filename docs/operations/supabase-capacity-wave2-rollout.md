# Supabase capacity — second rollout

Date: 2026-09-24. Production: `jsjsmuncfkbsbzqzqhfq`.

## Edge activation completed

- `process-workflow-executions`: version 168 → 169. Cron-authenticated
  `noop_probe` now returns before claims, recovery and workflow execution.
- `attach-to-org-by-pending-invite`: version 89 → 90. Correct supabase-js v2
  `getUser().data.user` handling and `Deno.serve` entrypoint.
- Compared each live entrypoint with reviewed repository source. Differences
  were exactly these approved changes. Uploaded existing live dependency files
  unchanged; JWT gateway settings preserved (workflow false, invite true).
- Ten focused behavioral tests passed, covering valid/invalid cron auth,
  ordinary worker recovery/claim, authenticated invitation identity, missing
  identity and client-supplied identity rejection.
- Live cron-authenticated `noop_probe`: HTTP 200, `healthy: true`, no timeout
  (pg_net request 146984). Unauthenticated POST: HTTP 401 on both endpoints.
  No real invitation was created/accepted during production verification.

## Frontend deployment correction

Earlier wave1 documentation inferred manual deployment from the GHCR workflow.
That inference was wrong: GitHub repository hook 627383107 is active for push,
targets EasyPanel and most recent response was HTTP 200. A separate deployment
path exists independently of GitHub Actions billing.

Read-only VPS inspection found `easypanel/v8_mvp/teste:latest` created at
2026-09-24T03:03:37.953178912Z, with container `0d42fb96fe65` running that image.
The image has no commit SHA label, so build time alone is not exact source
attestation. Do not report frontend deployment blocked solely by GitHub billing.

## WhatsApp test boundary

CAP-2409-01 was a self-chat test: the supplied destination matched TorqueSDR's
own number. Outgoing persistence was observed; external inbound delivery and
read receipts were not validated. This test does not validate the new ingress.
User redirected scope to database, workers, Edge and cron optimization.
Group policy and ingress remain inactive; no provider route change occurred.

## Cost interpretation

Activation and behavioral tests do not prove a monthly 1.4M invocation outcome.
Use existing historical projection for prioritization; confirm actual savings
after deployment without waiting for a full billing cycle to implement fixes.

## Next package validation

PR2165 merged as `6af187da3f3d822dc9ed710e800fa1199caac992` at
2026-09-24T03:45:48Z. Migration31 applied in production as
`20260924034604_cron_skip_idle_followups`, with lock timeout3s, statement
timeout30s and six original-body hash assertions inside the transaction.
Post-apply: all six body hashes match approved SQL; anon/authenticated EXECUTE
false, service_role true. All six schedules active (workflow every minute,
other five every five minutes). No worker invoked manually during verification.
Rollback remains the paired SQL file. Do not replay this migration based on
the different local2027version prefix.

GitHub CI again did not start because of account payment/spending restriction
(job107484586018 annotation). Local validation below is the available evidence;
no CI pass claimed. EasyPanel independently acknowledged merge push with HTTP200
at2026-09-24T03:45:50.864Z; acknowledgment alone is not proof of completed build.

Frontend rollout subsequently verified: image created
2026-09-24T03:47:26.878668816Z, container `265da5ecfc10` running it.
Its compiled `TVDashboard-MYwrPMui.js` contains the new `tv-coach-analysis`
query key. This verifies the changed code was included in the running bundle.

- Coach TV: eight behavioral tests and four existing contract tests passed;
  independent review covered identity/organization isolation, entitlement gate,
  remount caching, cooldown and explicit retry. Background interval does not
  fetch; an initial mount with no fresh cache can still fetch in background.
- Migration31: six admission predicates tested against real PGlite SQL,
  including all five timed workflow types, due-time boundary, positive work in
  another organization, effective ACL denials, unchanged HTTP/auth contract,
  rollback and reapply. Existing dispatch/campaign guard suites also passed.
- Build passed; TypeScript ratchet reports zero introduced errors.
- Lint reports five preexisting quote warnings, unchanged from main and from
  phase2 validation. No baseline suppression added.
- Full unit run: 13,568 passed, 152 failed, 154 skipped; seven collection errors
  are separate from test failures. Of 17 failures outside the recorded baseline,
  16 reproduced in clean main with the same dependencies. Agenda overlay passed
  in isolation both on clean main and this branch (16 tests); full-run failure
  remains an intermittent test limitation. Do not call the global suite green.
- Six live function body hashes matched rollback before activation preparation;
  apply must assert the same hashes again inside its transaction.
