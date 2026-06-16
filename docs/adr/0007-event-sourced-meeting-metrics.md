# 0007 — Event-sourced meeting metrics

Date: 2026-06-10
Status: accepted

## Context

All meeting metrics (dashboard Comando, Ranking, Goals, TV) count rows of `pipe_confirmacao` by **current status**. Three structural problems surfaced:

1. **The source is dying.** ADR-0004 merges Agendamentos into Oportunidades — meetings on the merged funnel live in `pipeline_entries(whatsapp)` stage `agendado` and may never touch `pipe_confirmacao`. Migrated orgs silently drop to zero meetings.
2. **State is mutable.** Dragging a card out of `agendado` erases a booked meeting from history retroactively. Metrics built on current state cannot be trusted as historical record.
3. **Attribution drift.** Three different attribution rules coexist (`sdr_id|closer_id|responsible_id` in `get_dashboard_metrics`, `sdr_id` only in `get_ranking_data`, `pre_sale_responsible_id ?? sdr_id` in `useSDRPerformance`). Meetings booked by a Pré-vendas (canonical field `pre_sale_responsible_id`) vanish from dashboard and ranking.

Additionally, the single goal type `reunioes` measured only meetings **held** (`compareceu`), while users expected meetings **booked** to count.

## Decision

Meeting metrics become **event-sourced**:

- Every booking writes an immutable **`meeting_booked`** event (lead, organization, pré-vendas snapshot, booked-at timestamp, meeting_date, source funnel/pipe).
- Every held meeting writes an immutable **`meeting_held`** event.
- Metrics, goals, and rankings read **only events** — never kanban state.
- Attribution is a **snapshot at event time** of the Lead's canonical **Pré-vendas** (`pre_sale_responsible_id`, legacy `sdr_id` as fallback during transition). Later owner changes do not rewrite history.
- Two separate goal types: `reunioes_marcadas` (counted in the booking period) and `reunioes_realizadas` (counted in the meeting-date period). Legacy `reunioes` maps to held.
- Capture is funnel-agnostic: system pipes, merged Oportunidades funnel (ADR-0004), custom pipelines, Copilot bookings, and external webhooks all emit the same events.
- Historical events are **backfilled** from `pipe_confirmacao` and `lead_history`.

## Consequences

- Meeting numbers survive the ADR-0004 merge, card re-drags, and custom funnels.
- Dashboard, Ranking, Goals, and TV converge on one attribution rule and one source — cross-screen consistency.
- Booking double-count semantics (reschedule vs re-book) must be defined explicitly on the event writer (see CONTEXT.md glossary).
- `get_dashboard_metrics`, `get_ranking_data`, and goal-progress hooks need rewrites; legacy `pipe_confirmacao`-based reads are deprecated.
- Sales metrics stay state-based for now (`pipe_propostas` terminal states are stable); only their attribution converges to the canonical Closer (`sale_responsible_id`, legacy fallback).
