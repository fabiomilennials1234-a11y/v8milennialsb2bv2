# Reaction retry audit — 2026-09-23

Production investigation remained read-only. A narrow local webhook correction
is included for explicitly identified groups with capture disabled.

## Implemented bounded correction

The reaction branch now shares the existing `normalizeMessage` JID/group-identity
logic through `messageChatIdentity` and reads
`organizations.capture_groups` for that resolved organization. Only an explicit
`false` skips the reaction before querying its target, matching the ordinary
message opt-out policy. The skip emits `uazapi_group_reaction_skipped` without
message content or phone numbers. Enabled groups retain persistence. A config
error or missing row defaults to persistence, matching ordinary group handling.
Direct-message missing targets still fail; there is no generic ACK or new DLQ.

Seven real-handler tests use the real Supabase SDK with mocked HTTP: group off
through both message and envelope identity, group on persisted with tenant and
instance filters, direct target missing, config error/missing, and config error
plus missing target. Together with existing extraction/ID regressions, 42 tests
pass; adding the question-button regressions yields 52 passing tests. ESLint shows
only the 10 existing `any` warnings in the webhook file, no
errors or added warnings. No measured savings assigned to this correction.

## Observed

The task's initial 24-hour snapshot counted 1,589 `Reaction target unavailable`
errors. A later bounded aggregate counted 1,632 across 20 organizations and 65
instances. Every organization in that later aggregate had `capture_groups=false`.
This is correlation, **not proof that those reaction events belong to groups**:
the error log stores the event name, instance and error, but not the target
message ID or chat identity.

`handleMessagesEvent` parses reactions before the ordinary group-capture gate.
It searches only the resolved organization and live instance, with message-ID
variants built from the target ID and instance phone/owner. Both a database error
and a successful lookup returning no row throw `Reaction target unavailable`.

The reaction branch's comment says failure uses the existing DLQ. Actual global
catch logs `uazapi_process_error` and responds 500 without enqueueing. Existing
DLQ enqueue calls belong to other error paths. The module CLAUDE.md statement
that every processing error is queued before 200 is also stale.

Possible missing-target causes remain unclassified:

- Group target intentionally not captured under current organization policy.
- Historical target never imported, or imported later/out of order.
- Target persisted under an earlier instance for the same chip.
- Database lookup error, currently indistinguishable from no matching row.
- ID prefix unavailable when instance phone is missing. The outer envelope's
  owner is not propagated by `uazapiEventMessage`, although the caller reads
  `data.owner` as a fallback.

No claim made that any one cause accounts for a measured percentage.

## Why not change 500 to 200 immediately

Acknowledge only successful persistence or an explicit product exclusion.
Changing the response alone loses reactions. The current shared DLQ is not a
complete solution for indefinitely missing history:

- Replay makes at most five attempts.
- Replay interval is five minutes.
- Live `whatsapp-dlq-retention` deletes unresolved records older than 14 days.
- Re-enqueueing a replay creates a new row and can make the original falsely
  appear resolved. A safe design must retain the same durable event.

## Remaining implementation

1. Classify missing-target versus database errors without recording message
   content, secrets or raw phone numbers in operational logs.
2. Measure the new explicit-group skip counter separately from remaining
   missing-target failures. Do not infer group membership from missing target.
3. Persist recoverable reactions durably before ACK, with idempotency per event,
   organization/instance/target/sender scope, bounded retries and visible exhausted
   state. Define retention for unresolved reactions instead of inheriting 14-day
   deletion silently.
4. Reconcile when target messages arrive or history import completes; preserve
   latest reaction/removal ordering and compare-and-swap sender updates.
5. Test unknown target, delayed target, deleted historical instance, disabled and
   enabled groups, database outage, queue failure, repeated provider delivery,
   repeated replay, reaction removal and concurrent senders. A queue write failure
   must remain non-2xx. Cross-organization targets must never resolve.

Existing regression suite `tests/unit/uazapi-event.test.ts` covers extraction and
merge semantics but not durable processing. Helpers alone cannot fix the missing
queue path in `whatsapp-webhook/index.ts`.

Potential savings are unquantified: errors are not distinct reaction IDs, and a
retry count per original event is unavailable. This work does not contribute a
claimed invocation reduction to the current capacity projection.
