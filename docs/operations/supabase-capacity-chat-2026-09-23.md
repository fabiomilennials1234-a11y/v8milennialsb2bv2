# Chat and Comando capacity evidence — 2026-09-23

## Scope and safety

Production inspected through read-only SQL. No function, index, data, retention,
or polling configuration changed in production. Security rubric applied to the
frontend delta: organization filter, server-owned visibility and query keys stay
unchanged; no new database function or grants.

## Implemented

`useConversasAguardando` previously fetched all referenced leads after every
successful waiting-conversations RPC, even when its returned profile name and
owner already supplied every field the UI uses. It now requests only leads whose
name or owner fallback is needed. An empty set uses the existing no-query return.

This removes one database REST request per chip refresh when all rows are
complete. Mixed results still make one request, with fewer IDs. It saves database
work and bandwidth, **not billed Edge Function invocations**. No percentage of
real-world savings is asserted without response-completeness telemetry.

Null and missing owners still use the existing fallback. Empty profile strings
keep their existing semantics. The legacy missing-RPC path is unchanged.

Validation: six tests in `src/modules/analytics/hooks/comando-rpc.test.tsx` pass,
using the real Supabase SDK with mocked HTTP. Cases include complete and mixed
responses, missing names, null/missing owners, empty profile names, tenant filter,
and real server errors.

## Database measurement

Read the installed definitions of `get_whatsapp_conversation_list_multi` and
`get_conversations_awaiting_human_reply`, rather than assuming repository migration
order represents the live database.

An `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` of **only the initial 30-day aggregate**
in the Comando RPC, for the instance with the most conversation-summary rows,
returned:

| Measurement | Value |
| --- | ---: |
| Execution time | 17,158.694 ms |
| Messages aggregated | 18,660 |
| Estimated messages | 650 |
| Conversation groups returned | 894 |
| Shared blocks read | 11,712 (~91.5 MiB at 8 KiB/block) |
| Shared blocks hit | 9,326 |
| Aggregate peak memory | 193 KiB |
| Aggregate spill to disk | 0 |

Plan: index scan on `idx_whatsapp_msgs_org_instance_ts`, then hash aggregate.
There were no rows removed by its deletion/group/normalized-phone filter.
This was one production measurement with substantial physical reads, **not a
benchmark average, p95, or full RPC duration**. No repeated heavy scan performed.

Reproduction inputs (internal identifiers, no customer content):

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT m.normalized_phone AS np,
       max(m."timestamp") FILTER (WHERE m.direction = 'incoming') AS last_in,
       max(m."timestamp") FILTER (
         WHERE m.direction = 'outgoing' AND m.sent_source = 'manual'
       ) AS last_human_out,
       max(m."timestamp") FILTER (
         WHERE m.direction = 'outgoing' AND m.sent_source <> 'manual'
       ) AS last_ai_out
FROM public.whatsapp_messages m
WHERE m.organization_id = '6711b1bf-6bb1-4aaa-beda-0c79b1eebdc3'
  AND m.instance_id = ANY(ARRAY['726df987-54b6-4ecd-9718-235f4de10c5e'::uuid])
  AND m.deleted_at IS NULL
  AND m.is_group = false
  AND m.normalized_phone IS NOT NULL
  AND m."timestamp" > now() - interval '30 days'
GROUP BY m.normalized_phone;
```

Subsequent `pg_stat_user_tables` inspection showed ~2,998,395 live and ~201,034
dead message tuples, recent autoanalyze (2026-09-23), and no autovacuum timestamp
in the current statistics window. A null timestamp does not establish that
vacuum never ran. These estimates do not quantify reclaimable disk space.

## Why no speculative SQL replacement in this delivery

The current summary stores the latest message but lacks latest incoming,
latest human outgoing, and latest automatic outgoing timestamps. Using only the
latest-message direction would silently remove conversations answered by AI from
the human waiting queue. The existing function intentionally preserves them.

A new covering index could reduce heap reads, but consumes additional disk and
write capacity on a table already carrying 20 indexes. It needs comparative plans,
size measurements and index-overlap review before acceptance. Poor cardinality
estimation also warrants evaluating multi-column statistics; recent autoanalyze
means simply assuming stale statistics is insufficient.

Next database step: reproduce with representative ephemeral data; compare
existing plan, extended statistics and a covering-index candidate. If the index
cannot fit the storage budget, design incremental incoming/human/AI timestamps
with parity tests for deletion, imports out of order, historical chip union,
archive precedence and owner restrictions. Do not use a partial summary as an
immediate replacement.

Unified chat already has global pagination, chip partitioning, per-user read
state and page-limited unread counts. No broad rewrite or removal of polling is
justified by the current evidence. Its remaining internal plan needs a separate
bounded measurement; earlier aggregate RPC averages do not locate its hotspot.

## Release and rollback

Frontend-only change; no database migration or release-order dependency. Rollback
is the prior frontend build. Validate the Comando card with complete and missing
profile names, ownerless leads and legacy responses. Observe network requests
per refresh; monitor database RPC latency separately, since this change does not
solve the measured history scan.

## Disk and exact-index audit — 22:27 UTC

Catalog audit compared all 20 `whatsapp_messages` indexes and 11 `runtime_logs`
indexes. Equality required access method, unique/null semantics, key and INCLUDE
positions, opclasses, collations, sort/null options, expression trees and predicate
trees. **Zero exact duplicate pairs.** No index-removal migration justified.

| Object | Total bytes | Index bytes |
| --- | ---: | ---: |
| Database | 9,886,305,427 | — |
| whatsapp_messages | 5,949,284,352 | 2,946,359,296 |
| runtime_logs | 727,187,456 | 527,122,432 |

These are allocated PostgreSQL relation sizes, not billed provisioned disk or
proven live-data size. Decimal GB and binary GiB must not be mixed when comparing
the billing allowance. Row deletion does not itself shrink allocated relations.

Examples showing why superficial redundancy is insufficient:

| Index | Bytes | Recorded scans | Decision |
| --- | ---: | ---: | --- |
| idx_whatsapp_msgs_org_instance_phone | 325,361,664 | 3 | Raw phone differs from normalized phone; not identical to its partial counterpart |
| idx_whatsapp_msgs_org_inst_dir_ts | 187,260,928 | 85 | Incoming predicate includes deleted/groups; unread-cover excludes both |
| idx_runtime_logs_status_created | 198,410,240 | 1 | Distinct status/time access path; sparse usage alone does not prove redundancy |
| idx_runtime_logs_org_created | 154,263,552 | 16 | Tenant/time access path; module indexes do not replace it |
| idx_runtime_logs_module_created | 47,325,184 | 2,100 | Module/time ordering differs from module/action/time |

Unique message-ID/instance index (345,088,000 bytes) enforces deduplication.
WhatsApp primary key is referenced by `copilot_message_queue` and
`workflow_button_replies`. Neither is a removal candidate. Other candidate rows
above are neither unique constraints nor replica identity, but that alone does
not establish workload equivalence. No dependency-driven drop attempted.

Database statistics reset timestamp was null. Statement-statistics reset was
2026-09-17 13:52:36 UTC; **that does not date the table/index counters**. Therefore
these scans cannot safely be advertised as "uses per last six days".

Message counters: 85,560 inserts, 205,135 updates, 38 deletes. Log counters:
786,145 inserts, 795,946 deletes. They show churn, but lack a trustworthy common
start and historical byte snapshots. No monthly growth or reclaimable-space
estimate inferred from them. Likewise, high index/data ratio alone does not prove
index bloat. A targeted bloat measurement and tested concurrent rebuild would
need maintenance budget and temporary free space before consideration.

## Follow-up measurements

`scripts/sql/supabase-capacity-observe.sql` captures bounded catalog/statistics
snapshots in a read-only transaction, with 5-second statement and 1-second lock
timeouts. It emits no query text or customer messages. Run before release and
again after comparable operating windows; keep results as internal artifacts.
The component queries were validated against production catalog/statistics.

Compare `queryid, dbid, userid, toplevel` for RPC counters; reject comparisons
after a stats reset or counter decrease. Interval mean latency is
`delta(total_exec_time) / delta(calls)`, not the difference between means.
Snapshot maxima are cumulative maxima, not p95. Relation byte deltas measure
allocated-size growth; tuple counters do not measure physical bytes. Rebuilt
indexes get a new OID and require a new baseline.

Read-only statement snapshot at audit time:

| RPC / normalized query variant | Calls | Mean ms | Maximum ms |
| --- | ---: | ---: | ---: |
| conversation_list_multi / 4446591818342389375 | 5,282 | 1,284.84 | 14,657.49 |
| conversation_list_multi / 4753051656162361006 | 3,324 | 1,341.32 | 14,961.84 |
| awaiting_human_reply / -376314938678829135 | 871 | 2,700.60 | 14,979.30 |

These remain the baseline for database work, separate from the Edge Function
invocation budget. This release does not claim to bring provisioned disk inside
the allowance. That constraint remains open until measured reclamation and a
supported provisioned-volume reduction path are established.
