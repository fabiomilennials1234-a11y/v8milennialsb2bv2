# 0018 — Prod RPC snapshot protocol (until repo↔prod reconciliation)

Date: 2026-07-07
Status: accepted

## Context

Discovered 2026-07-03: production (`jsjsmuncfkbsbzqzqhfq`) holds migrations (up to `20270106000001`) absent from the repo, and several live function bodies diverge from their repo files (e.g. live `get_analytics_pipeline_metrics` reads `meeting_events`; the repo file still reads `pipe_confirmacao`). The SP-0 fix files in the repo are mis-dated with stale bodies. A blind `supabase db push` would **regress production**. Full repo↔prod reconciliation is necessary but is its own project; making it a blocking prerequisite would stall the metrics program indefinitely, while continuing to patch prod ad hoc (as SP-0 did) perpetuates the repo-as-fiction problem.

## Decision

A middle path, scoped to the metrics program (SP-0.5):

1. **Prod is the source of truth for RPC bodies** until reconciliation completes.
2. Before touching any metric RPC, fetch its **live body** from prod (`pg_get_functiondef`) and commit it as a correctly-dated snapshot migration. These snapshots are the base all SP-3 rewrites diff against.
3. Never `db push` the known-stale files (`20261202000000..000400` SP-0 series and any file older than a live redefinition) — they are superseded by the snapshots.
4. Every subsequent RPC change ships as a new migration on top of its snapshot, restoring repo-as-truth **for the metrics surface** going forward.
5. Full-system reconciliation (pulling the 2027 migrations, re-dating, edge-function drift) remains a separate scheduled effort; this protocol is the template it will follow.

## Consequences

- SP-1→SP-4 build on verified bodies, not stale files — no silent regression risk on the metrics surface.
- The repo becomes truthful incrementally, surface by surface, instead of after one big freeze.
- Until full reconciliation, `db push` of anything outside the metrics surface remains dangerous — the standing rule "no blind db push" (see memory/runbooks) stays in force.
- Snapshot migrations are mildly unusual artifacts (they re-declare what prod already has); their names carry a `snapshot_` prefix so future readers understand they are baselines, not changes.
