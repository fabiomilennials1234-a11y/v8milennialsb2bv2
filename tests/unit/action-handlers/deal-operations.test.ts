// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../../helpers/supabase-mock";
import { createDeal } from "../../../supabase/functions/_shared/action-handlers/deal-operations";

const LEAD = {
  id: "lead-1",
  organization_id: "org-1",
  name: "Acme",
  company: "Acme Ltda",
  responsible_id: "tm-1",
  sale_responsible_id: null,
  closer_id: null,
  pre_sale_responsible_id: null,
  sdr_id: null,
};

function seed() {
  const mock = createMockSupabase();
  mock.mockTable("leads", [LEAD]);
  mock.mockTable("deals", []);
  return mock;
}

describe("createDeal — shared action handler", () => {
  it("rejects execution without lead", async () => {
    const { sb } = seed();
    const result = await createDeal({
      supabase: sb, organizationId: "org-1", leadId: null,
      conversationId: null, params: {},
    });
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
  });

  it("creates the deal linked to the lead and exposes deal_id", async () => {
    const { sb, getInserted } = seed();
    const result = await createDeal({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      conversationId: null,
      params: {
        dealTitleTemplate: "Negócio — Acme",
        dealValue: 1500,
        dealProbability: 70,
        _executionId: "exec-9",
      },
    });

    expect(result.success).toBe(true);
    const inserted = getInserted("deals")[0] as Record<string, unknown>;
    expect(inserted.source_lead_id).toBe("lead-1");
    expect(inserted.organization_id).toBe("org-1");
    expect(inserted.title).toBe("Negócio — Acme");
    expect(inserted.value).toBe(1500);
    expect(inserted.probability).toBe(70);
    expect(inserted.owner_id).toBe("tm-1");
    // Procedência canônica — sem ela o INSERT em prod é recusado por
    // fn_deals_exige_procedencia (CHECK deals_source_check).
    expect(inserted.source).toBe("workflow");
    // marca de origem — alimenta o guard de chain_depth do trigger deal_created
    expect(inserted.metadata).toMatchObject({
      created_by: "workflow",
      workflow_execution_id: "exec-9",
    });
    expect(result.data?.deal_id).toBeDefined();
  });

  it("clamps probability to 0..100", async () => {
    const { sb, getInserted } = seed();
    await createDeal({
      supabase: sb, organizationId: "org-1", leadId: "lead-1",
      conversationId: null, params: { dealProbability: 250 },
    });
    expect((getInserted("deals")[0] as Record<string, unknown>).probability).toBe(100);
  });

  it("skips when the lead already has an open deal", async () => {
    const mock = seed();
    mock.mockTable("deals", [
      { id: "deal-open", organization_id: "org-1", source_lead_id: "lead-1", won: null, deleted_at: null },
    ]);

    const result = await createDeal({
      supabase: mock.sb, organizationId: "org-1", leadId: "lead-1",
      conversationId: null, params: {},
    });

    expect(result.success).toBe(true);
    expect(result.data?.skipped).toBe(true);
    expect(mock.getInserted("deals")).toHaveLength(0);
  });

  it("creates a second deal when the dedup guard is off", async () => {
    const mock = seed();
    mock.mockTable("deals", [
      { id: "deal-open", organization_id: "org-1", source_lead_id: "lead-1", won: null, deleted_at: null },
    ]);

    const result = await createDeal({
      supabase: mock.sb, organizationId: "org-1", leadId: "lead-1",
      conversationId: null, params: { dealSkipIfOpenExists: false },
    });

    expect(result.success).toBe(true);
    expect(mock.getInserted("deals")).toHaveLength(1);
  });
});
