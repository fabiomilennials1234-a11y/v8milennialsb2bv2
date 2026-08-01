# 23. The Negócio is the funnel unit, and it moves

Date: 2026-08-01

## Status

Accepted

Supersedes **ADR-0005** (Carteira as a standalone post-sale feature) — Carteira becomes a facet of the Lead, not a module beside it.
Inverts the invariant "a Lead can exist in multiple pipelines simultaneously", documented in `CLAUDE.md` and `CONTEXT.md` since the modular-monolith work.

## Context

Torque's funnels were built on an identity the product outgrew: **the Lead *was* the card**. One person, one row, one stage, one pipeline at a time. Three costs, all measured in production before this decision:

- **Repeat purchase was impossible.** Three uniqueness locks forbade the same Lead having two cards in the same funnel. A customer who bought in March and returned in September had nowhere to be recorded — the seller reused the March card and erased the first sale, or created a duplicate person.
- **The pipeline number meant nothing.** Every Lead became a card automatically, so "deals in the funnel" and "people who arrived" were the same figure. There was no way to say what the pipeline was worth without counting everyone who had asked a price.
- **A finished feature nobody could use.** The `deals` table has existed for months with **zero rows**. Someone modelled it, shipped the schema, and never lit it. `CONTEXT.md` defined **Deal** as *"a monetary negotiation attached to a Lead. Distinct from Pipeline — Deal tracks money, Pipeline tracks progress."* That definition is precisely why the table stayed empty: a money record that does not move through the funnel has no moment at which anyone would create it.

The glossary and the product had drifted apart, and the drift was load-bearing. This ADR resolves it by choosing the other reading.

## Decision

**1. The Negócio, not the Lead, is what moves through a Pipeline.** A Lead is the durable identity of a person or company and **never has a Stage**. A Negócio is one attempt to sell to that Lead, and it is the thing that occupies a Stage.

**2. Lead 1 → N Negócio.** A Negócio belongs to exactly one Lead and inherits its data at creation. A Lead may have several, **including two open at once in the same funnel** — that is what makes repeat purchase representable, and it is the reason the three locks were dropped (migration `20270730000050`).

**3. A Negócio is born only by human click.** No ingest path, no integration and no automation creates one. A Lead arriving from an ad, a form, a spreadsheet or Cal.com exists in Leads and nowhere else until a person decides there is a sale to pursue. Rejected: allowing progress-driven creation (`compareceu` auto-creating an Orçamento). Decision 4 removes the need for it.

**4. A Negócio holds exactly one position at a time, and advancing is a *move*, not a copy.** Its journey is linear — beginning, middle, end. Reaching `compareceu` in Oportunidades moves the Negócio into Orçamentos; it does not leave a twin behind. The Oportunidades board therefore holds only work in progress, and its `compareceu` column drains as Negócios advance (**201 cards** sit there today). Nothing is lost: the trail is event-sourced already — **47.077 stage events covering 36.312 of 36.812 cards (98,6%)**, and meeting counts read events, never column occupancy (ADR-0007, ADR-0017).

**5. The position lives on the card, guaranteed by a unique index.** `pipeline_entries` keeps one row per Negócio and that row travels; `deals` carries identity and money. `deals.pipeline_id` and `deals.stage_id` are dropped — under decision 4 they would be a second truth again. A unique index on `pipeline_entries.deal_id` makes "one Negócio in two places" impossible at the database, rather than a property that 26 separate write paths must each honour.

Rejected: putting the position on `deals`. Every board, the Copilot and the metrics read `pipeline_entries`; the only surface reading `deals.pipeline_id`/`stage_id` is `/negocios`, which this decision retires.

**6. The Leads page is the single source of truth about a Lead**, and it states **two derived facts, never collapsed into one**: **Relação** (`Lead` / `Cliente` — has ever won a Negócio; monotonic) and **Situação** (`Em negociação`, showing the most advanced open Negócio / `Sem negócio aberto`). Measured: 26.982 Leads have one Negócio, **4.380 have several all open**, **170 have a won and an open one at the same time** and 72 a lost and an open one. Any single-value status would have to hide half the truth in exactly the 170 cases the feature exists to represent — the returning customer being worked again is `Cliente · Em negociação`.

**7. Cliente is one word with one meaning: someone who has bought.** The proof may be a won Negócio or an ERP order. Measured: 220 Leads would read `Cliente` from a won Negócio, 739 rows exist in Carteira, and only **52** are in both — two near-disjoint populations sharing a word.

**8. Carteira is a facet of the Lead, not a module beside it** (supersedes ADR-0005). Every person the Organization deals with lives in **Leads**; Carteira is what that page shows once the person has bought. Costless in data: all **739** Carteira clients already point at a Lead — 0 unlinked, 0 orphaned, 0 cross-org; 4 sit in the trash.

**9. The Negócio's title is derived and editable.** Default `Negócio de <mês>/<ano>` at creation time, changeable afterwards. Rejected: a required field (friction on the only creation door, and 36k migrated rows would need an invented value) and a non-editable derivation (B2B wants "Reposição trimestral"). Rejected specifically: deriving from the funnel name — it distinguishes nothing and would have produced tens of thousands of Negócios called "Qualificação".

**10. The Copilot reads the Negócio's position, not the Lead's.** `decide-action.ts` resolves the current stage from `leads.pipe_whatsapp`, a denormalized column that is the Lead holding a Stage — forbidden by decision 1, and already unreliable (**1.885 Leads in 34 orgs** where it disagrees with the card). Under decision 4 a trigger nulls that column when a Negócio leaves Oportunidades, so leaving this alone would silently change the agent's behaviour on the pilot's first day. The column survives as a legacy mirror and is dropped in a later slice.

**11. The backfill creates one Negócio per journey, positioned at the furthest point reached.** System funnels are one journey; each custom funnel is a separate commercial motion and therefore its own Negócio. Measured against production: one-per-card yields **36.812**, one-per-journey **35.886**, one-per-Lead 31.601. The difference is **926 Negócios** concentrated in the **597 Leads** holding cards in two system funnels at once — the Oportunidades + Orçamentos pair.

## Consequences

**What this forces**

- `/negocios` is retired. It is the only reader of the two position columns decision 5 drops — 8 files, ~1.485 lines, zero tests. It is reachable by URL with the gate **open in 89 of 96 organizations**, so retiring it also closes a door people can walk through today.
- Ingest paths stop writing to funnels. Two n8n nodes POST directly into `custom_pipe_entries`; under decision 3 that is creating a Negócio from ingest. They are reduced to creating and updating the Lead.
- Cross-org responsáveis must be cleared before the trigger from migration `20270731000010` is lit — **1.594 Leads** across two organizations, from two old imports.

**Deploy order is not a preference**

Frontend tolerance and the n8n nodes ship **before** the schema. If the database goes first, form ingest breaks silently — the webhook answers 200, the Lead is created, only the card is missing — and **45.678 duplicate pairs across 52 organizations** sit one merge click away in `/duplicados`.

**What we accept**

- Sellers lose a visible pile of `compareceu` cards on the Oportunidades board. The count survives as a number, not a column.
- A Negócio can be renamed, so titles will drift from the derived default. That is the point.
- Turning the pilot on means two behaviours coexist in the same funnel for a while: Negócios created before the switch and Leads arriving after it that produce none. Handled as an operational notice to the pilot organization, not as product surface.

**Correction of record**

ADR-0005 described `handle_proposta_vendida` (`pipe_propostas.status = 'vendido'` → `INSERT upsell_clients`) as *"the only working entry"* into Carteira. Measured in production and on a QA branch: that function exists with **zero triggers attached and zero callers**. All 739 Carteira rows came from ERP sync. Winning a Negócio does not create a Carteira Client today; making it do so is a new feature with its own cost, not a repair.
