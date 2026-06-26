# 0013 — Productivity: activity-in-period indicator on Performance

Date: 2026-06-25
Status: accepted

## Context

The Performance page shows team gamification (ranking, goals, competition), and the dashboard counters for meetings/sales are **cohort-by-creation**: a period filter selects Leads that *entered* in that period, then counts what those Leads ever reached. This silently drops cross-period activity — a Lead that entered in May but had its meeting booked in June does not appear when filtering June, because the Lead was not "born" in June. Managers reading "what did we do this month" get an undercount.

The data foundation to count by action-date already exists:

- **Reuniões Marcadas / Realizadas** — `meeting_events` (ADR-0007) are immutable, dated (`occurred_at` for booked, `meeting_date` for held), attributed to the Pré-vendas at event time. Reschedule double-count is already defined (>30 days = new booking).
- **Vendido** — `pipeline_entries` stage `vendido` on the `propostas` system pipe; the move timestamp comes from a durable source (`lead_history` move row), not mutable kanban state.
- **Novos leads** — `leads.created_at`.

A near-identical capability is also reachable through the **Funnel Health Indicator (Saúde do Funil)**, which already has an "activity-in-period" toggle (ADR docs / `get_funnel_health`). The open question was whether to satisfy the request by exposing that toggle or by building a dedicated surface.

## Decision

Add a **Produtividade** block at the top of the Performance "Ranking de Vendas" tab — a separate, dedicated surface, **not** a reuse of the Funnel Health toggle.

- Four counts: **Novos leads**, **Reuniões Marcadas**, **Reuniões Realizadas**, **Vendido**.
- Every count is keyed to the **date of the action itself** (event occurrence), never to Lead creation/entry date. This is the whole point and is made **explicit in the UI** (a visible note + the per-count drill showing the exact action timestamp).
- Org-wide by default, with an optional narrow to a single Team Member. Attribution: **Pré-vendas** for meetings, **Closer** for sales (consistent with ADR-0007).
- Filter is a **free date range with presets**, not the page's month/year selector.
- Backed by a **new RPC `get_productivity_activity(org, from, to, seller?)`** — distinct from `get_funnel_health`, which stays cohort-by-creation.

Rejected — reusing Funnel Health's activity toggle: it is a manager-facing analytics screen (conversion rates + traffic-light benchmarks, six funnel blocks); the request is a whole-team Performance surface with raw counts and a simple per-Lead drill. Same date semantics, different audience and shape — folding one into the other would distort both.

## Consequences

- Two surfaces share the "activity-in-period" date semantics but stay separate by audience/shape: **Funnel Health** (manager, rates, cohort-default) and **Produtividade** (whole team, raw counts, action-date-only). A future reader must not collapse them; the CONTEXT.md glossary records the distinction.
- A new RPC duplicates some SQL with `get_funnel_health`'s activity path. Accepted as the cost of keeping the two contracts independent; if drift becomes a maintenance burden, a shared activity CTE can be extracted later.
- **Vendido** gains a first dated read via `lead_history`; if that source proves unreliable for some orgs, a dedicated sale event (mirroring `meeting_events`) becomes the fallback — ADR-0007 deliberately kept sales state-based, so this stays an open escape hatch, not a commitment.
- Cross-period activity stops vanishing from the team's view; the Performance counters and Produtividade tell a consistent "what was done in this window" story.
