# 0017 — Event-sourced sales & stage metrics

Date: 2026-07-07
Status: accepted

## Context

The 2026-07-02 metrics audit confirmed 24 inconsistencies with 6 root causes, all traceable to metrics computed over **mutable state**: `stage_key` strings without FK (renaming a stage zeroes revenue), 5+ competing time anchors (`closed_at`/`created_at`/`updated_at`/…), divergent attribution keys (a sale appears on the leaderboard but generates no commission), `type='system'` predicates that blind custom pipelines, and dual sources of truth on the same screen. `get_dashboard_metrics` was patched ~18 times without convergence. Meanwhile ADR-0007 (`meeting_events`) proved the event-sourced pattern works: meeting metrics are the only stable ones. Post-audit code (productivity-by-seller RPC, Carteira recompute trigger) reintroduced the root causes, proving convention alone does not hold. The Carteira also created a second, unreconciled revenue surface.

## Decision

Extend ADR-0007's pattern to funnel and sales. Two new append-only ledgers become the ONLY source metrics read:

- **`pipeline_stage_events`** — every stage transition on `pipeline_entries` (unified table; legacy pipes are compat views over it, so one trigger covers system + custom funnels).
- **`sale_events`** — written when a Lead enters a `won`/`lost` stage.

Governing decisions, in the order they were resolved:

1. **Stage semantics = single `stage_role` enum** on `pipeline_stages` (`open | meeting_booked | meeting_held | won | lost`), NOT parallel boolean flags — exclusivity by construction, contradictory states impossible. Existing `is_final_positive/negative` stay as board-UI semantics and are forbidden as metric inputs. Role assignment: deterministic map for known system stage_keys; AI Stage Classifier (ADR-0006 pattern) suggests for custom stages; `won`/`lost` suggestions require human confirmation (money), meeting roles auto-apply.
2. **Revenue Stream stamped per sale, determined by the client, not the funnel**: Lead already has a Carteira Client record at sale time → `carteira`, else `novo_negocio`. One ledger holds both streams; dashboards display them separately; the total is their sum by construction. Kills the second revenue surface.
3. **Reversals, not erasure**: leaving a `won` stage appends a `sale_reversed` event referencing the original; the pair annuls in every read (original period restored). No event is ever edited or deleted. Reversals cascade to projected commissions and are themselves auditable.
4. **Sale date = registration moment, always** (`sold_at = now()` at event write). No user-supplied or backdated sale dates, no exceptions — tamper-proof over convenience (CTO decision; a Friday sale registered Monday counts on Monday).
5. **Periods cut in the Organization's timezone** — new `organizations.timezone` column (default `America/Sao_Paulo`); period boundaries resolved exclusively by the database; the frontend names periods and never converts dates.
6. **Commission is a projection** of `sale_events` via trigger — ledger equals metric by construction.
7. **Backfill is best-effort with a declared contractual cutover: 2026-12-01** (unified stage logging became solid then). Reconstructed events carry `source='backfill'`; pre-cutover funnel history is explicitly best-effort.
8. **Reconciliation gate = explained deltas + internal invariants.** New engine vs old engine over real data: every diverging cell must link to a numbered audit finding or a decision in this ADR, else the gate fails; plus invariant suite (per-member sums equal totals, rates ∈ [0,100], monotonic funnel) in CI. Strict equality would reject the fixes; unexplained tolerance would hide new bugs.
9. **CI guardrail precedes construction**: a migration-lint blocking the recurring anti-patterns in new metric code (`type='system'` predicates, attribution COALESCE chains, `updated_at` as time anchor, revenue aggregation outside the ledgers), plus documented rationale in `supabase/migrations/CLAUDE.md`.

## Consequences

- Renaming or reordering stages never changes any metric; custom-pipeline orgs get real numbers (R1, R2, R3 die).
- One anchor and one attribution snapshot per event (R4, R5 die); TV/commission dual sources collapse into the ledgers (R6 dies).
- Dashboards gain a reversal/audit dimension that did not exist.
- `get_dashboard_metrics`, ranking, TV client-side aggregation, and Carteira revenue recompute must be rewritten to read ledgers only (SP-3); legacy RPCs stay alive until the reconciliation gate passes (rollback path).
- Pre-2026-12 funnel depth will look shallower than the (wrong) legacy numbers — accepted and labeled, not masked.
- New-stage creation flows must set a role (classifier-suggested) — a small UX addition to stage editors.
