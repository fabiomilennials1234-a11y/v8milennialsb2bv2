# Meeting date on the deal card

## Diagnosis — 2026-09-08

The card reads `pipeline_entries.metadata.meeting_date`. Meetings created from a
preselected lead/pipeline submit a null deal_id, because the picker only resolves
it when the user explicitly selects a lead. Legacy entries can also lack a deal.
The database projection returned immediately on a null meeting.deal_id.

Read-only production baseline: 7 missing dates can be recovered unambiguously
across 3 organizations, including the 3 TorqueCRM cards reported by the user.

## Correction

The server projection accepts exactly one open entry for the meeting's
organization/pipeline/lead when there is no explicit deal. Explicit deal remains
preferred and must match supplied lead and pipeline. No feature flag, no org list.
Multiple open entries remain unresolved; the existing picker offers deal choice.
No synthetic deals are created and no meeting records are rewritten.

Cancellation, deletion, event-type and relationship changes remove only the
projection owned by that meeting. Manual date changes survive cleanup.

## Validation and deployment

1. Run `node scripts/test-meeting-date-projection.mjs <approved-preview-ref>`.
   Real SQL/trigger assertions execute against isolated fixture tables in a
   unique schema, inside a transaction that rolls back. Covers legacy cards,
   prefilled links, ambiguity, explicit deals, closed entries, foreign org,
   pipeline changes, rescheduling, cancellation, deletion and manual dates.
2. Validate against the actual preview schema and its existing triggers.
3. Review/apply only `20271017000000_meeting_date_unique_pipeline_entry.sql`.
   Do not blindly push unrelated pending migrations.
4. Run `scripts/sql/recover-meeting-dates-20260908.sql` on the approved target.
   It backs up metadata, skips existing dates and ambiguous meetings, and avoids
   activity timestamp/legacy mirror side effects. The existing capture trigger
   recognizes the revision stamp and suppresses duplicate events.
5. Verify card metadata and EXECUTE grants; test actual card render after refresh.

Rollback function bodies were captured from production. Data rollback restores
only rows whose metadata still exactly matches this recovery's output. Later
changes are preserved. The rollback currently requires the recovery backup table.

Validation: PostgreSQL assertions passed on preview mkpjjtwjyvgabavnxqgp. Migration, recovery and rollback also executed against its public schema inside a rolled-back transaction. No preview changes persisted. Production applied with CTO authorization on 2026-09-08 at approximately 14:23 UTC. Ledger version 20271017000000 matches the file. Recovery restored 7 dates in 3 organizations; all 7 metadata values match the backup projection. Internal EXECUTE grants are denied to anon/authenticated. Production UI smoke has not been performed.
