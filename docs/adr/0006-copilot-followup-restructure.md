# 6. Copilot Follow-up restructure — situation-bound, owner-driven, Torque-curated

Date: 2026-06-08

## Status

Accepted

## Context

"Follow-up" in the product is two unrelated systems sharing one name, plus a third concept that overlaps both:

1. **Copilot Follow-up (System A)** — `process-copilot-followups` (cron 5min) sends autonomous WhatsApp re-engagement when a Lead goes silent. Rules live in `copilot_agent_followup_rules`, attached to a Copilot Agent of legacy `template_type = 'followup'`. The config UI (`AgentFollowupRulesTab`) is surfaced **only** for that agent type.

2. **Follow-up Task (System B)** — `process-followup-automations` creates a human to-do row in `follow_ups` for a Team Member. Sends no message. Different actor, different output.

3. Three cadence engines coexist doing near-identical work: Copilot Follow-up, **Workflows** (delay / wait_response / copilot / cron nodes), and **Campaigns** (message sequences).

This ADR is about **System A** (the Copilot's autonomous re-engagement). It is broken in structural ways:

- **Orphaned by the archetype migration.** Copilot v2 (ADR-0002) collapses agent types into three Archetypes (Qualificador / Vendedor / Carteira) and deprecates the v1 `followup` type. But System A is bolted to that dead type — in the new model, follow-up has no home, and the config UI only renders for an agent type that is going away. v2 (`copilot_v2_*`, `agent-runtime-v2`) ships **no follow-up at all** yet.

- **Trigger-blind candidate sourcing.** The RPC `get_followup_eligible_leads` selects Leads whose *last WhatsApp message was outgoing + delay elapsed* — and that single crude filter is used for **every** trigger type. The five real trigger types (`no_response`, `after_qualification`, `after_meeting_scheduled`, `post_sale`, `proposal_no_response`) exist in TS (`followup-triggers.ts`) but are gated *after* the RPC, which already mis-filters: for `post_sale` / `after_qualification` the Lead's last message may be inbound, and the per-step cadence delay conflicts with the rule-level delay the RPC pre-filters on. Eligibility is split awkwardly between SQL and TS, and the SQL half wins wrongly.

- **Weak stop conditions.** A cadence stops on Lead reply (`markCadenceCompletedOnResponse`) and `max_followups`. But a **human replying only pauses** (Human Pause, 60min) — it does not cancel, so the IA resumes cutucando behind a human who has taken over. Stage resolution (proposal → vendido) and owner handoff do not stop the cadence either.

- **Free-form rule builder.** The UI lets an Org assemble arbitrary rules (tags, origins, pipes, stages, business hours, styles, templates, priority). High surface for misconfiguration → over-messaging → number bans. This contradicts the v2 philosophy (Torque owns the hard parts; the client fills structured slots).

The pre-rebuild v1 Copilot is what runs in production for all ~30 orgs **today**; v2 is live-but-inert (`is_active=false`, Milennials only). Orgs are being hurt now, so doing nothing or "wait for v2" is not acceptable.

## Decision

Restructure Copilot Follow-up as a **dedicated, situation-bound, owner-driven, Torque-curated** capability. Seven decisions:

1. **Fix in v1 now, design for v2 inheritance.** Implement against the live v1 Copilot so the ~30 orgs benefit immediately, but model the concept (situations, ownership, stop rules, curated defaults) so v2 (`copilot_v2_*`) inherits it cleanly rather than re-inventing it. Work is not throwaway.

2. **Triggers are bound to the Lead's situation, not a generic timer.** Eligibility derives from funnel position + state ("proposal sent, no reply for X"), never from "last message was ours + N hours". The crude RPC is replaced/narrowed; each situation owns its own eligibility query and timing.

3. **A fixed set of six canonical Follow-up Situations**, each bound to an owning Archetype:
   - **Qualificador** — (a) new Lead approached, no reply; (b) qualified, no meeting booked.
   - **Vendedor** — (c) meeting reminder *(reminder only — never sets Meeting Confirmation Status, per ADR-0004)*; (d) no-show → rebook; (e) proposal sent, no reply.
   - **Carteira** — (f) dormant client → win-back.

4. **Ownership-driven, not a separate "followup" agent.** The Archetype that currently owns the Lead (by `get_contact_status` + stage) owns its re-engagement. The v1 `followup` agent type is retired as the home for this.

5. **Stop conditions** — a cadence stops on any of: Lead reply, Lead opt-out, steps exhausted, **the owning human replying (cancel, not pause)**, **the triggering Situation being resolved** (e.g. proposal → `vendido`), or **owner handoff** (old cadence dies; new owner may start its own).

6. **Torque-curated config, not a free-form builder.** Torque ships the six Situations with sane default cadences and copy. The Org only enables/disables each Situation and tunes basics (number of touches, spacing, optional copy override). No authoring Situations from scratch. An "advanced mode" may be opened later if a real need appears.

7. **Hybrid message generation.** Each touch has a Torque-authored base text (with variables); the LLM optionally refines it from live conversation context; the base text is the deterministic fallback if the LLM fails or is skipped. No purely-generic copy, no unbounded LLM cost.

**Scope:** This ADR governs System A only. System B (Follow-up Task) is untouched. Follow-up is **not** folded into the Workflow engine.

## Consequences

**Positive**
- Follow-up gets a home that survives the v1→v2 transition; v2 inherits a defined concept instead of a gap.
- Right Lead, right moment, right message — situation-bound triggers stop cutucando clients who have nothing pending (the `post_sale`/no_response false-fire).
- Fewer bans and fewer angry clients — curated cadences + hard stop on human-takeover and situation-resolution.
- Eligibility stops being split-brain between a wrong SQL filter and correct-but-bypassed TS.

**Negative / costs**
- A dedicated follow-up engine persists alongside Workflows and Campaigns (three cadence engines). Accepted: the six Situations are fixed and curated — the opposite of a user-built DAG — so generality would be a worse fit, not a better one.
- Less flexibility for an Org wanting a bespoke cadence (mitigated by future "advanced mode").
- The work lands in v1 first and must be ported to v2 when v2 activates — deliberate double-touch, justified by present-day org pain.

**Follow-ups**
- Sharpen the live system: replace/narrow `get_followup_eligible_leads`, finish the situation-eligibility logic, wire the new stop conditions (human-reply cancel, situation-resolved cancel, owner-handoff kill), curate the six Situations + default copy, rebuild the config UI from free-form rules to enable/disable + basics.
- Glossary updated in `CONTEXT.md` (Follow-up split into **Copilot Follow-up** vs **Follow-up Task**; **Follow-up Situation** defined).

## Amendment — 2026-06-08 — Per-org stage mapping + AI Stage Classifier

Real prod data (Milennials) invalidated the assumption that Situations can key on canonical stage keys:

- Orgs **rename funnel stages freely**, and the `stage_key` is desynced legacy noise — Milennials' propostas stage `marcar_compromisso` is literally named **"Proposta Gerada"**, `r2_fechamento` is **"Negociando"**. Only the `name` carries meaning. A resolver hardcoding `'enviada'`/`'vendido'` never fires (or misfires) for ~30 customized orgs.
- The old "last message was ours + N hours" filter would have re-engaged **38 Milennials leads sitting in won (`Vendido`) or lost (`Perdido`)** stages — exactly the false-fire the restructure exists to kill.

**Decisions:**

1. **A Situation's trigger stages are per-org config**, not hardcoded. `copilot_followup_situation_config.trigger_stage_keys text[]` holds the org's own stage_keys that place a Lead IN the Situation. The resolver consumes this set; a Lead whose stage leaves the set exits the situation automatically (this replaces the hardcoded `vendido` stop — won/lost/other stages simply aren't in the trigger set).

2. **`trigger_stage_keys` is populated automatically by an AI Stage Classifier**, not by hand (does not scale to 30 orgs). An LLM reads each org's stages (`name` + `position` + the reliable `is_final_positive`/`is_final_negative` flags) and maps each stage to a canonical situation role (proposta_ativa / frio / ganho / perdido / reuniao / no_show / novo / qualificado), re-run on stage change. `is_final_positive`/`is_final_negative` are a **hard override** — terminal stages never enter any trigger set regardless of the LLM. The org may review/override the mapping in the config UI.

3. **The resolver stays pure and deterministic** — it never calls an LLM; it only consumes the classified `trigger_stage_keys`. The AI lives entirely in the offline population step.
