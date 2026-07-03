import type { ActionInput, ActionResult } from "./types.ts";

/**
 * Marks (or unmarks) a Checklist Item on a Lead from a Workflow node.
 *
 * Addressing (ADR-0016): the node stores `templateItemId` — the id of the item on
 * the *template*. At runtime we resolve the Lead's copy/copies via the stable
 * `checklist_items.template_item_id` lineage, scoped to the Lead + org. Marking
 * hits ALL matching copies, so a Lead carrying legacy duplicate Checklists from the
 * same template stays consistent.
 *
 * Absent Checklist (item never applied to this Lead) → success no-op with a message
 * that surfaces in the execution log; never a hard failure that would stall the DAG.
 *
 * Completion rollup: when a mark completes the last open item of a Checklist, the
 * Checklist's own `is_completed` flips to true (and back to false on unmark that
 * reopens it). This is the only server-side rollup of checklist completion — the UI
 * otherwise computes it client-side.
 */
export async function markChecklistItem(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;
  const templateItemId = (params.templateItemId as string | undefined)?.trim();
  const action = ((params.action as string | undefined) ?? "mark").toLowerCase();
  const markDone = action !== "unmark"; // default: mark

  if (!templateItemId) {
    return { success: false, error: "templateItemId nao configurado no no" };
  }
  if (!leadId) {
    return { success: false, error: "Workflow sem lead vinculado — mark_checklist_item requer leadId" };
  }

  // Lead's checklists (org-scoped). Also gives us the checklist ids for rollup.
  const { data: leadChecklists, error: clErr } = await supabase
    .from("checklists")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId);

  if (clErr) return { success: false, error: clErr.message };

  const checklistIds = (leadChecklists ?? []).map((c: { id: string }) => c.id);
  if (checklistIds.length === 0) {
    return {
      success: true,
      message: "Lead nao possui checklist — item nao marcado (no-op)",
      data: { matched: 0, template_item_id: templateItemId },
    };
  }

  // Resolve the target item(s) by lineage, scoped to this Lead's checklists.
  const { data: items, error: iErr } = await supabase
    .from("checklist_items")
    .select("id, checklist_id")
    .in("checklist_id", checklistIds)
    .eq("template_item_id", templateItemId);

  if (iErr) return { success: false, error: iErr.message };

  if (!items || items.length === 0) {
    return {
      success: true,
      message: "Item do checklist nao encontrado no lead — no-op",
      data: { matched: 0, template_item_id: templateItemId },
    };
  }

  const itemIds = items.map((i: { id: string }) => i.id);

  const { error: upErr } = await supabase
    .from("checklist_items")
    .update({
      is_completed: markDone,
      completed_at: markDone ? new Date().toISOString() : null,
    })
    .in("id", itemIds);

  if (upErr) return { success: false, error: upErr.message };

  // Rollup: recompute each affected Checklist's completion from its items.
  const affectedChecklistIds = [...new Set(items.map((i: { checklist_id: string }) => i.checklist_id))];
  for (const cid of affectedChecklistIds) {
    const { data: siblings, error: sErr } = await supabase
      .from("checklist_items")
      .select("is_completed")
      .eq("checklist_id", cid);
    if (sErr) return { success: false, error: sErr.message };

    const all = siblings ?? [];
    const allDone = all.length > 0 && all.every((s: { is_completed: boolean }) => s.is_completed);
    const { error: rErr } = await supabase
      .from("checklists")
      .update({ is_completed: allDone })
      .eq("id", cid);
    if (rErr) return { success: false, error: rErr.message };
  }

  return {
    success: true,
    message: `${markDone ? "Marcado" : "Desmarcado"} ${itemIds.length} item(ns) do checklist`,
    data: {
      matched: itemIds.length,
      action: markDone ? "mark" : "unmark",
      template_item_id: templateItemId,
    },
  };
}
