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

/** Seeds the tables applyChecklist reads on the happy path. leadOrg = the org the lead belongs to. */
function seed(
  checklists: Record<string, unknown>[],
  items: Record<string, unknown>[] = [],
  leadOrg: string = "org-1",
) {
  const m = createMockSupabase();
  m.mockTable("checklists", checklists);
  m.mockTable("checklist_items", items);
  m.mockTable("leads", [{ id: "lead-1", organization_id: leadOrg }]);
  return m;
}

const TEMPLATE = { id: "tpl-1", organization_id: "org-1", title: "Onboarding", description: null, lead_id: null };

function run(m: ReturnType<typeof seed>, overrides: Partial<ActionInput> = {}) {
  return applyChecklist({
    supabase: m.sb,
    organizationId: "org-1",
    leadId: "lead-1",
    conversationId: null,
    params: { checklistTemplateId: "tpl-1" },
    ...overrides,
  });
}

describe("applyChecklist", () => {
  it("fails when checklistTemplateId missing", async () => {
    const result = await applyChecklist(makeInput({}));
    expect(result.success).toBe(false);
    expect(result.error).toContain("checklistTemplateId");
  });

  it("fails when leadId is null (no orphan checklist)", async () => {
    const m = seed([TEMPLATE]);
    const result = await run(m, { leadId: null });
    expect(result.success).toBe(false);
    expect(result.error).toContain("leadId");
    expect(m.getInserted("checklists").length).toBe(0);
  });

  it("fails when template not found", async () => {
    const m = seed([]);
    const result = await run(m, { params: { checklistTemplateId: "nonexistent" } });
    expect(result.success).toBe(false);
    expect(result.error).toContain("encontrado");
  });

  it("fails when template belongs to different org", async () => {
    const m = seed([{ ...TEMPLATE, organization_id: "other-org" }]);
    const result = await run(m);
    expect(result.success).toBe(false);
    expect(result.error).toContain("outra");
  });

  it("fails when target is not a template (lead_id not null)", async () => {
    const m = seed([{ ...TEMPLATE, lead_id: "some-lead" }]);
    const result = await run(m);
    expect(result.success).toBe(false);
    expect(result.error).toContain("template");
  });

  it("fails when the lead belongs to a different org (defense-in-depth)", async () => {
    const m = seed([TEMPLATE], [], "other-org");
    const result = await run(m);
    expect(result.success).toBe(false);
    expect(result.error).toContain("organizacao");
    expect(m.getInserted("checklists").length).toBe(0);
  });

  it("creates checklist + items from template", async () => {
    const m = seed([{ ...TEMPLATE, description: "Welcome checklist" }], [
      { title: "Task 1", position: 1, checklist_id: "tpl-1" },
      { title: "Task 2", position: 2, checklist_id: "tpl-1" },
    ]);
    const result = await run(m);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Onboarding");
    expect(result.message).toContain("2 itens");
    expect(result.data?.template_id).toBe("tpl-1");

    const checklists = m.getInserted("checklists");
    expect(checklists.length).toBe(1);
    expect(checklists[0]).toMatchObject({
      organization_id: "org-1",
      title: "Onboarding",
      lead_id: "lead-1",
    });

    const items = m.getInserted("checklist_items");
    expect(items.length).toBe(2);
    expect(items[0].title).toBe("Task 1");
    expect(items[1].title).toBe("Task 2");
  });

  it("succeeds with zero template items", async () => {
    const m = seed([{ ...TEMPLATE, title: "Empty" }], []);
    const result = await run(m);
    expect(result.success).toBe(true);
    expect(result.message).toContain("0 itens");
    expect(m.getInserted("checklist_items").length).toBe(0);
  });

  it("stamps source_template_id on the created checklist", async () => {
    const m = seed([TEMPLATE], []);
    const result = await run(m);
    expect(result.success).toBe(true);
    expect(m.getInserted("checklists")[0].source_template_id).toBe("tpl-1");
  });

  it("is idempotent when template already applied to the lead", async () => {
    const m = seed([
      TEMPLATE,
      { id: "cl-existing", organization_id: "org-1", title: "Onboarding", lead_id: "lead-1", source_template_id: "tpl-1" },
    ]);
    const result = await run(m);
    expect(result.success).toBe(true);
    expect(result.data?.idempotent).toBe(true);
    expect(result.data?.checklist_id).toBe("cl-existing");
    expect(m.getInserted("checklists").length).toBe(0);
  });

  it("treats a 23505 unique-violation race as idempotent success", async () => {
    // Pre-check finds nothing (no applied row in the table), then the INSERT
    // loses the race against a concurrent writer and fails on the partial
    // unique index. The handler must swallow 23505 and report idempotent.
    const m = seed([TEMPLATE], []);
    m.mockInsertError("checklists", { code: "23505", message: "duplicate key value violates unique constraint" });
    const result = await run(m);
    expect(result.success).toBe(true);
    expect(result.data?.idempotent).toBe(true);
    expect(m.getInserted("checklists").length).toBe(0);
  });
});
