# 16. Checklist items carry template lineage (`template_item_id`)

Date: 2026-07-02

## Status

Accepted

## Context

We are adding a Workflow action node that marks (or unmarks) a single **Checklist Item** on a Lead — e.g. an automation that sends a proposal also checks the "Enviar proposta" box. This forces a question the domain never had to answer before: **how does a design-time node address a runtime item?**

When a Checklist template is copied onto a Lead (via the `apply_checklist` handler, the `apply_stage_checklist` stage trigger, or the manual frontend apply), each copied item gets a **fresh uuid** and carries over only `title` and `position`. Nothing links a copied item back to the template item it came from — the only lineage that exists is at the checklist level (`checklists.source_template_id`), not the item level. So at the moment a workflow author configures the node, the target item's id does not exist yet.

Three ways to bind the node to an item were considered:

- **By title text.** Author picks the item's title; runtime matches `checklist_items.title`. Zero schema change, but silently breaks if the item is renamed on the Lead, and is ambiguous when two items share a title.
- **By template + position.** Stable against renames, brittle against reordering; still a positional heuristic, not an identity.
- **By a real lineage column.** Add `checklist_items.template_item_id` populated at copy time, so every Lead item points at the exact template item it descends from. Schema change + backfill, but a true stable identity.

## Decision

Add `checklist_items.template_item_id uuid` (nullable, self-referencing FK → `checklist_items.id`), populated at **every** copy path: the `apply_checklist` edge handler, the `apply_stage_checklist` DB trigger, and the manual frontend apply. Template items have it null; Lead items point at their source template item.

The workflow node stores `template_item_id` (not the item's title). At runtime it resolves the target as: the Lead's checklist item(s) whose `template_item_id` matches, scoped to that Lead. This is the "C" option from the design grill — chosen over title-matching because it is the only one that survives a rename and is unambiguous under duplicate titles, matching the world-class-durability bar for a control that silently no-ops when it misfires.

Existing checklist items (created before this column) are **backfilled** by matching template↔copy on `(title, position)` within each `source_template_id` group, so the node works on Leads that already exist — not only on Leads created after the migration.

## Consequences

- The manual frontend apply path (`useApplyChecklistTemplate`) currently inserts **without** `source_template_id`, bypassing the `uniq_checklists_lead_source` dedup index and letting a Lead accumulate duplicate checklists from the same template. Populating lineage requires this path to set `source_template_id` too — which **also fixes that duplicate bug** as a side effect. The node's runtime resolution nonetheless marks **all** matching items, so it stays correct even where legacy duplicates already exist.
- Backfill is a best-effort `(title, position)` heuristic — the exact ambiguity we rejected for the runtime path. Items renamed or reordered before the migration may backfill to the wrong template item or not at all; those resolve to null lineage and the node no-ops on them (logged in the execution, never a hard failure). This is an accepted one-time imprecision, bounded to pre-existing data.
- Item-level lineage is now a first-class relationship, not just checklist-level. This is the foundation for the natural follow-ups — a **checklist-item-completed / checklist-completed trigger**, and a **condition node** gating on item state — all of which need to address a stable item identity across the template→Lead boundary, which only this column provides.
- Marking the last open item via the node recomputes and sets `checklists.is_completed = true` server-side. Today `is_completed` is only ever set by client-computed aggregates; this introduces the first server-side rollup of checklist completion, on this path only.
