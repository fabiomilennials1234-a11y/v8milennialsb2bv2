# 31. The subject of an automation is the Negócio, not only the Lead

Date: 2026-08-25

## Status

Accepted

Completes **ADR-0023** (the Negócio is the funnel unit) in the last surface that still contradicted it: the automation engine.

## Context

ADR-0023 §1 says the Negócio, not the Lead, is what moves through a Pipeline, and that a Lead **never has a Stage**. Every surface was migrated to that: the board, the Copilot (§10), the metrics. The automation engine was not, and it was not a partial migration — the model had **no place to put the answer**.

Measured in production on 2026-08-25:

- **`ActionInput`, the contract every one of the 30 action handlers receives, carried `leadId` and nothing else.** No `entryId`, no `dealId`. An action about a funnel had to talk about the person and then *guess* which Negócio was meant — `pickActiveEntry`, "the open one, else the most recent".
- **`workflow_executions` had `lead_id` and nothing else.** The execution could not record what it was acting on.
- **Both stage triggers run ON the funnel entry** — `trigger_workflow_pipeline_stage_changed` has `NEW.id` and `NEW.deal_id` in hand — **and threw both away** before calling the engine.
- **Dedup was keyed `(workflow_id, lead_id)`.** Two Negócios of the same Lead entering the same stage: the second was discarded as a duplicate, silently. ADR-0023 §2 explicitly allows "two open at once in the same funnel", so the engine forbade in practice the model the product had already decided.
- **`{{estagio}}` and the `stage` condition read the Oportunidades card with the funnel hard-coded to `whatsapp`.** A condition inside an Orçamentos workflow compared against the wrong card — or against an empty string after a move. Not a missing send: a wrong decision, repeated, with nothing on screen to denounce it.

Scale of the blind spot: **399 of the 14.185 executions in 30 days** ran on Leads with 2+ Negócios; **146 of the 759 template-applied checklists (19%)** sit on such Leads, where the second Negócio silently received nothing.

## Decision

**1. An execution has a composite subject: `{ leadId, entryId?, dealId? }`.** The Lead never leaves — every workflow drawn before this keeps running unchanged. What is added is a place where "which Negócio" fits.

**2. The key is `pipeline_entries.id`, not `deals.id`.** ADR-0023 §5 puts the travelling position on the entry; `deals` carries identity and money. Measured: **12.021 of 46.684 entries (26%) have no `deals` row**, and among cards created since 2026-08-24 the proportion exceeds 97%. Keying on `deals` would blind the engine to most of what enters the funnel. `deal_id` rides along when it exists, because it is what answers value and provenance (ADR-0030 §4).

**3. The subject travels inside `context`, not as a new RPC parameter.** `fire_workflow_trigger` is called by several triggers and the HTTP edge (`mode: fire_trigger`) only forwards `context`. Adding a parameter would force every caller to change at once; a key in `context` is additive.

**4. Dedup scope follows the subject.** Funnel-born trigger → scope is the Negócio. Person-born trigger (`lead_created`, `tag_added`) → scope stays the Lead, which is the right subject there. The Negócio id also enters `trigger_dedup_key`, because the unique index is `(workflow_id, lead_id, trigger_dedup_key)` and without it two cards of the same Lead collide on the index.

**5. Actions that touch a funnel act on the Negócio that fired, and fall back to the old criterion when there is none.** Every behaviour change is therefore bounded: no workflow running today changes verdict unless a Negócio is declared.

**6. Advancing between funnels is a MOVE, through the same RPC the UI uses.** `move_stage` called `upsertPipeEntryDetailed`, which creates a card in the destination funnel and leaves the origin behind — the copy ADR-0023 §4 forbids. With a known entry it now calls `mover_negocio`.

**7. Checklist belongs to the Negócio, with the Lead as the wider scope.** Decision by the CTO on 2026-08-25. `checklists.pipeline_entry_id` NULL means *of the person* — valid for all their Negócios. That is what the 1.338 existing rows are, and why there is no backfill: claiming they belong to one Negócio would invent a fact. Idempotency splits accordingly: unique `(entry, template)` for the Negócio scope, and the old `(lead, template)` restricted to rows without a Negócio.

**8. "Won" and "lost" are positions, not columns.** `deal_won`/`deal_lost` are derived from `stage_changed` by the destination stage's role. They deliberately do not read `deals.won`: the backfill left **34.662 of 34.980 rows with `won = false`** for deals nobody lost — the column answers "was not won", not "was lost" — and it is blind to the 26% without a `deals` row.

## Consequences

**What this forces**

- Two migrations before any of it is readable: columns on `workflow_executions` and on `checklists`, plus the three trigger functions.
- The engine's five links each have to forward the subject: DB trigger → `fireTrigger` → execution row → dedup → `ActionInput`. A link that forgets makes the subject null, which degrades to the old behaviour rather than failing — deliberate, and the reason the rollout is safe.
- `getStageDoNegocio` lives in `_shared/negocio-subject.ts`, not in `pipeline-adapter`. Twenty test files stub the adapter with a factory, and a factory is a closed list: a new export there broke 53 cases in one run.

**What we accept**

- During the transition, an execution created before the columns existed has a null entry and no longer blocks a re-dispatch of the same card. Ceiling: one extra dispatch per workflow, inside the 300s window, once.
- `deal_won`/`deal_lost` fire per funnel terminal stage, so a Negócio that crosses two funnels can produce two "won" events over its life. That is what the board shows already.
- Checklists applied before this ADR keep reading as "of the person" and therefore appear in every Negócio of that Lead. Correcting them individually is a per-organization decision, not a migration.
