# 5. Carteira as a standalone post-sale feature (out of the funnels)

Date: 2026-06-07

## Status

Accepted

## Context

"Carteira" existed in two incompatible shapes at once:

1. **Legacy Upsell kanban** — two pipe-type boards, `upsell_base` and `upsell_gestao`, labeled "Carteira Base" and "Carteira Gestão". Surfaced as a funnel (`usePipelineDisplayConfig` listed `upsell` as a "Carteira" pipe at position 4) and offered as **success-stage move destinations** in the stage-config dropdown ("Ao chegar nesta etapa, mover lead para: … Carteira Base / Carteira Gestão").

2. **New Carteira (Customer Portfolio)** — a table/analytics surface over `upsell_clients` (health score, segments ouro/prata/novo/resgate/dormindo, recompra prediction, churn, retention, approvals), gated behind the `customer_portfolio` feature flag.

Two problems:

- **The kanban no longer fits.** Post-sale is a recurring relationship managed by segment, not a stage-progression board. The legacy kanban "não tem mais cara de kanban e nem faz mais sentido ali".
- **The success-stage destinations were dead.** Selecting "Carteira Base" / "Carteira Gestão" as a stage's move-target was a **no-op** at runtime — no handler in the kanban/page move logic acted on `target_pipe_type in (upsell_base, upsell_gestao)`, and even if it had, the new Carteira reads `upsell_clients` by segment, not those pipe stages. Result: Leads configured to move to "Carteira" on a success stage silently vanished — they never landed in the Carteira the org actually looks at. The only working entry was the `handle_proposta_vendida` trigger (`pipe_propostas.status = 'vendido'` → `INSERT upsell_clients`).

## Decision

**Carteira becomes a standalone top-level feature, removed from the funnels.**

1. **Topbar, not Funis.** Carteira gets its own `primaryNavItems` entry next to Agenda. Removed from the Funis display config (`usePipelineDisplayConfig`) — it is no longer a Pipeline. Route promoted to `/carteira` (list); `/upsell` kept as a redirect alias. `/carteira/:clientId` (detail) already existed.

2. **Legacy kanban retired for all orgs.** `customer_portfolio` is enabled universally; the non-portfolio Upsell layout (Base/Gestão tabs, `UpsellBaseKanban` / `UpsellGestaoKanban`) is deleted. No flag fallback. Underlying data is unaffected — both shapes already read/write the same `upsell_clients` table.

3. **Entry is deterministic-by-sale, with one optional manual destination.**
   - Primary: the `handle_proposta_vendida` trigger continues to create the Carteira Client on `vendido` (unchanged).
   - Optional: the two legacy success-stage destinations collapse into a **single "Carteira" destination**. Reaching a success stage wired to it creates an `upsell_clients` row — idempotent on `(organization_id, lead_id)`, landing in segment `novo`. This is the configurable path for clients who bought outside the standard Orçamentos flow.
   - Existing `pipeline_stages` rows with `target_pipe_type in ('upsell_base','upsell_gestao')` are migrated to the new `carteira` destination so previously-broken configs start working.

## Consequences

**Positive**
- One Carteira concept, one surface. The "two carteiras" confusion is gone.
- The silent-drop bug is fixed: a success stage pointing at Carteira now actually admits the Lead.
- Carteira's information architecture (table + segments + analytics) matches what post-sale actually is.

**Negative / risks**
- Aggressive rollout (all orgs at once, no fallback). Any org that was actively working the Base/Gestão kanban loses that board UI — mitigated because the data persists and re-surfaces in the portfolio table by segment.
- `useAutoMoveUpsellClients` / gestão auto-move rules were keyed to the legacy Base/Gestão stages and become **orphaned**; they need follow-up cleanup or re-targeting to the segment model.
- Adds a Carteira-write path to generic funnel stage moves (not just the propostas trigger); both paths must stay idempotent to avoid duplicate clients.

## Related

- [ADR-0004](./0004-merge-agendamentos-into-oportunidades.md) — same Milennials-style "collapse a board into the thing it belongs to" pattern.
- `CONTEXT.md` → **Carteira (Customer Portfolio)**.
