// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../../helpers/supabase-mock";
import type { ActionInput } from "../../../supabase/functions/_shared/action-handlers/types";
import { applyChecklist } from "../../../supabase/functions/_shared/action-handlers/checklist-operations";

function makeInput(params: Record<string, unknown> = {}): ActionInput {
  const { sb } = createMockSupabase();
  return {
    supabase: sb,
    organizationId: "org-1",
    leadId: "lead-1",
    conversationId: null,
    params,
  };
}

describe("applyChecklist", () => {
  it("fails when checklistTemplateId missing", async () => {
    const result = await applyChecklist(makeInput({}));
    expect(result.success).toBe(false);
    expect(result.error).toContain("checklistTemplateId");
  });

  it("fails when template not found", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("checklists", []);

    const result = await applyChecklist({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { checklistTemplateId: "nonexistent" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("encontrado");
  });

  it("fails when template belongs to different org", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("checklists", [
      { id: "tpl-1", organization_id: "other-org", title: "Onboarding", description: null, lead_id: null },
    ]);

    const result = await applyChecklist({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { checklistTemplateId: "tpl-1" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("outra");
  });

  it("fails when target is not a template (lead_id not null)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("checklists", [
      { id: "tpl-1", organization_id: "org-1", title: "Onboarding", description: null, lead_id: "some-lead" },
    ]);

    const result = await applyChecklist({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { checklistTemplateId: "tpl-1" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("template");
  });

  it("creates checklist + items from template", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("checklists", [
      { id: "tpl-1", organization_id: "org-1", title: "Onboarding", description: "Welcome checklist", lead_id: null },
    ]);
    mockTable("checklist_items", [
      { title: "Task 1", position: 1, checklist_id: "tpl-1" },
      { title: "Task 2", position: 2, checklist_id: "tpl-1" },
    ]);

    const result = await applyChecklist({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { checklistTemplateId: "tpl-1" },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Onboarding");
    expect(result.message).toContain("2 itens");
    expect(result.data?.template_id).toBe("tpl-1");

    const checklists = getInserted("checklists");
    expect(checklists.length).toBe(1);
    expect(checklists[0]).toMatchObject({
      organization_id: "org-1",
      title: "Onboarding",
      lead_id: "lead-1",
    });

    const items = getInserted("checklist_items");
    expect(items.length).toBe(2);
    expect(items[0].title).toBe("Task 1");
    expect(items[1].title).toBe("Task 2");
  });

  it("succeeds with zero template items", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("checklists", [
      { id: "tpl-1", organization_id: "org-1", title: "Empty", description: null, lead_id: null },
    ]);
    mockTable("checklist_items", []);

    const result = await applyChecklist({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { checklistTemplateId: "tpl-1" },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("0 itens");
    expect(getInserted("checklist_items").length).toBe(0);
  });
});
