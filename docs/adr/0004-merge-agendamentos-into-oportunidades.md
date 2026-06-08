# 4. Merge Agendamentos into Oportunidades; confirmation becomes a card-level status

Date: 2026-06-07

## Status

Accepted

## Context

The system shipped three system pipelines: **Oportunidades** (`pipe_whatsapp`, qualification), **Agendamentos** (`pipe_confirmacao`, meeting confirmation), and **Orçamentos** (`pipe_propostas`, closing). Agendamentos carried nine stages, six of which (`reuniao_marcada`, `confirmar_d5/d3/d2/d1`, `confirmacao_no_dia`) exist only to chase a confirmation as the meeting date approaches. A salesperson dragged the same card across those six columns day after day to express one fact: *is this meeting confirmed yet?*

That is a status, not a funnel. A whole pipeline — its own board, nav item, analytics, ingest webhook, and cross-pipe move surface — exists to model a three-state flag. The qualification funnel (Oportunidades) ends at `agendado`, then the lead jumps to a *separate* board to manage the meeting it just booked. The seam adds navigation cost and duplicates the lead across two pipes for no domain reason.

Since the Wave-1 consolidation, all three pipes are already views over a single `pipeline_entries` table with per-org stages in `pipeline_stages`. The structural cost of collapsing two of them is therefore low; the work is stage config, a data migration, and rewiring the surfaces that name `pipe_confirmacao`. The Copilot `agendador` archetype that drove confirmation reminders is already deprecated by the three-archetype model (Qualificador/Vendedor/Carteira), so the merge does not strand a live agent type.

## Decision

1. **Agendamentos folds into Oportunidades as one linear funnel.** Stages: `novo → abordado → respondeu → esfriou → agendado → remarcar → compareceu → nao_compareceu`. The six reminder stages are deleted. `agendado` stops being a final-positive stage; `compareceu` becomes the positive terminal.

2. **Meeting confirmation is a card-level status, not a stage.** A new `confirmation_status` enum (`pendente → pre_confirmado → confirmado`) lives on the `agendado` entry's metadata, superseding the legacy `is_confirmed` boolean. It is surfaced as a **date-aware button added to the existing kanban card** (the card is not otherwise redesigned): label is "Pré-confirmar" before the meeting calendar-day, "Confirmar" on the day, evaluated in the Organization's timezone. **Manual-only in v1** — the Copilot may still send D-5/D-3/D-1 reminders, but never sets the status. Rescheduling (Remarcar → new `meeting_date`) resets it to `pendente`.

3. **`compareceu` auto-creates an Orçamentos entry.** Reaching `compareceu` inserts a `pipe_propostas` entry at its initial stage, so a closer picks the lead up without a manual move. The lead lives in both pipes.

4. **True loss is a loss-reason action, not a stage.** `nao_compareceu` is a recoverable no-show column (can be rescheduled). Permanent loss reuses the existing loss-reason mechanism and leaves the active board. Legacy `perdido` entries migrate to a closed-lost state tagged with a `"perda histórica (agendamento)"` loss reason — preserving historical loss analytics without an orphan column.

5. **Rollout is gated by a per-org feature flag, not derived from data.** A `merged_opportunity_funnel` flag (platform module) switches the merged funnel, the confirmation button, and the retirement of the standalone Agendamentos surfaces. Milennials first; the other ~29 orgs keep current behavior until the flag flips. Stage-driven (implicit "hide the board when confirmacao is empty") was rejected: it has no clean instant rollback and reopens unexpectedly on stray entries.

6. **Ingest endpoints survive, retargeted.** `webhook-confirmacao`, `webhook-calcom`, and `google-calendar-webhook` keep their URLs (external n8n / calendar integrations depend on them) but land leads in the merged funnel's `agendado` stage instead of `pipe_confirmacao`.

## Consequences

- **The data migration is destructive and cross-pipe — the riskiest step.** It repoints `pipeline_entries.pipeline_id` from confirmacao to whatsapp and rewrites `stage_key`. A lead present in *both* pipes yields two rows that collide on the merge (likely a `UNIQUE(lead_id, pipeline_id)`); the confirmacao entry wins (further along), absorbs the meeting metadata, and the whatsapp entry is dropped. This dedup must run *before* the repoint. The per-org feature flag is the rollback lever, so it must gate behavior on day one.
- **Reporting loses D-5/D-3/D-1 granularity.** The old confirmation funnel (Reuniões → Confirmadas → Compareceram, stepped by day-out) collapses into `confirmation_status` counts plus the `compareceu` stage. Accepted: the per-day reminder breakdown was operational noise, not a metric anyone steered by.
- **A future reader will ask "where is the Agendamentos pipeline?"** This ADR is the answer: it did not move, it dissolved — its outcome stages live in Oportunidades and its reminder stages became one button.
- **`pipe_confirmacao` view and its compat triggers remain for non-flagged orgs** during the staged rollout; they can be dropped only after every org is on the flag. Until then, both behaviors coexist in the codebase.
- **The `agendador` deprecation is now load-bearing.** The merge assumes no live agent depends on the reminder stages. If an org still runs a v1 `agendador`, it must be migrated to the Vendedor archetype before its flag flips.
