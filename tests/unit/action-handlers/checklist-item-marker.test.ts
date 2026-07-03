// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../../helpers/supabase-mock";
import type { ActionInput } from "../../../supabase/functions/_shared/action-handlers/types";
import { markChecklistItem } from "../../../supabase/functions/_shared/action-handlers/checklist-item-marker";

/**
 * Seeds a Lead with one checklist (cl-1) applied from a template, whose items
 * carry template_item_id lineage. `items` are the lead-copy items.
 */
function seedLead(
  items: Record<string, unknown>[],
  checklists: Record<string, unknown>[] = [{ id: "cl-1", organization_id: "org-1", lead_id: "lead-1", is_completed: false }],
) {
  const m = createMockSupabase();
  m.mockTable("checklists", checklists);
  m.mockTable("checklist_items", items);
  return m;
}

function run(m: ReturnType<typeof seedLead>, params: Record<string, unknown>, overrides: Partial<ActionInput> = {}) {
  return markChecklistItem({
    supabase: m.sb,
    organizationId: "org-1",
    leadId: "lead-1",
    conversationId: null,
    params,
    ...overrides,
  });
}

describe("markChecklistItem", () => {
  it("fails when templateItemId missing", async () => {
    const m = seedLead([]);
    const result = await run(m, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("templateItemId");
  });

  it("fails when leadId is null", async () => {
    const m = seedLead([]);
    const result = await run(m, { templateItemId: "tpl-item-a" }, { leadId: null });
    expect(result.success).toBe(false);
    expect(result.error).toContain("leadId");
  });

  it("marks the matching lead item by template lineage", async () => {
    const m = seedLead([
      { id: "li-1", checklist_id: "cl-1", title: "Enviar proposta", is_completed: false, template_item_id: "tpl-item-a" },
      { id: "li-2", checklist_id: "cl-1", title: "Outra", is_completed: false, template_item_id: "tpl-item-b" },
    ]);
    const result = await run(m, { templateItemId: "tpl-item-a" });

    expect(result.success).toBe(true);
    expect(result.data?.matched).toBe(1);
    const updated = m.getUpdated("checklist_items");
    // Only li-1 got marked, with completed_at set.
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ id: "li-1", is_completed: true });
    expect(updated[0].completed_at).toBeTruthy();
  });

  it("no-op (success) when the lead has no checklist at all", async () => {
    const m = seedLead([], []); // no checklists on the lead
    const result = await run(m, { templateItemId: "tpl-item-a" });
    expect(result.success).toBe(true);
    expect(result.data?.matched).toBe(0);
    expect(m.getUpdated("checklist_items")).toHaveLength(0);
  });

  it("no-op (success) when no item matches the template lineage", async () => {
    const m = seedLead([
      { id: "li-1", checklist_id: "cl-1", title: "Enviar proposta", is_completed: false, template_item_id: "tpl-item-a" },
    ]);
    const result = await run(m, { templateItemId: "tpl-item-ZZZ" });
    expect(result.success).toBe(true);
    expect(result.data?.matched).toBe(0);
    expect(m.getUpdated("checklist_items")).toHaveLength(0);
  });

  it("marks the item in every duplicate checklist copy (legacy dup safety)", async () => {
    const m = seedLead(
      [
        { id: "li-1", checklist_id: "cl-1", title: "Enviar proposta", is_completed: false, template_item_id: "tpl-item-a" },
        { id: "li-2", checklist_id: "cl-2", title: "Enviar proposta", is_completed: false, template_item_id: "tpl-item-a" },
      ],
      [
        { id: "cl-1", organization_id: "org-1", lead_id: "lead-1", is_completed: false },
        { id: "cl-2", organization_id: "org-1", lead_id: "lead-1", is_completed: false },
      ],
    );
    const result = await run(m, { templateItemId: "tpl-item-a" });
    expect(result.success).toBe(true);
    expect(result.data?.matched).toBe(2);
    expect(m.getUpdated("checklist_items")).toHaveLength(2);
  });

  it("completes the checklist when marking the last open item (rollup)", async () => {
    const m = seedLead([
      { id: "li-1", checklist_id: "cl-1", title: "A", is_completed: true, template_item_id: "tpl-item-a" },
      { id: "li-2", checklist_id: "cl-1", title: "B", is_completed: false, template_item_id: "tpl-item-b" },
    ]);
    const result = await run(m, { templateItemId: "tpl-item-b" });
    expect(result.success).toBe(true);

    const updatedChecklists = m.getUpdated("checklists");
    expect(updatedChecklists.some((c) => c.id === "cl-1" && c.is_completed === true)).toBe(true);
  });

  it("does not complete the checklist while items remain open", async () => {
    const m = seedLead([
      { id: "li-1", checklist_id: "cl-1", title: "A", is_completed: false, template_item_id: "tpl-item-a" },
      { id: "li-2", checklist_id: "cl-1", title: "B", is_completed: false, template_item_id: "tpl-item-b" },
    ]);
    const result = await run(m, { templateItemId: "tpl-item-a" });
    expect(result.success).toBe(true);

    const updatedChecklists = m.getUpdated("checklists");
    // cl-1 rollup ran but must resolve to not-complete (li-2 still open).
    expect(updatedChecklists.every((c) => c.is_completed === false)).toBe(true);
  });
});
