import { describe, it, expect, vi, beforeEach } from "vitest";

const insertCalls: Array<Record<string, unknown>> = [];
let nextResult: { data: { id: string } | null; error: { message: string } | null } = {
  data: { id: "evt-1" },
  error: null,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        insertCalls.push({ table, row });
        return {
          select: (_cols: string) => ({
            single: () => Promise.resolve(nextResult),
          }),
        };
      },
    }),
  },
}));

import { publishEvent } from "@/integrations/supabase/events";

describe("publishEvent (client-side wrapper)", () => {
  beforeEach(() => {
    insertCalls.length = 0;
    nextResult = { data: { id: "evt-1" }, error: null };
  });

  it("insere row em domain_events com shape esperado", async () => {
    const id = await publishEvent({
      event_type: "lead.stage_changed",
      aggregate_type: "campanha_lead",
      aggregate_id: "agg-1",
      organization_id: "org-1",
      payload: {
        lead_id: "lead-1",
        pipeline_id: null,
        campaign_id: "camp-1",
        pipe_type: null,
        old_stage_key: null,
        new_stage_key: "novo",
        pipeline_slug: null,
      },
    });

    expect(id).toBe("evt-1");
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe("domain_events");
    expect(insertCalls[0].row).toMatchObject({
      organization_id: "org-1",
      event_type: "lead.stage_changed",
      aggregate_type: "campanha_lead",
      aggregate_id: "agg-1",
      metadata: {},
    });
  });

  it("default metadata vira objeto vazio quando ausente", async () => {
    await publishEvent({
      event_type: "lead.stage_changed",
      aggregate_type: "pipeline_entry",
      aggregate_id: "pe-1",
      organization_id: "org-2",
      payload: {
        lead_id: "lead-2",
        pipeline_id: "pl-1",
        campaign_id: null,
        pipe_type: "whatsapp",
        old_stage_key: "novo",
        new_stage_key: "abordado",
        pipeline_slug: "whatsapp",
      },
    });

    expect((insertCalls[0].row as Record<string, unknown>).metadata).toEqual({});
  });

  it("lança erro quando insert falha", async () => {
    nextResult = { data: null, error: { message: "rls denied" } };

    await expect(
      publishEvent({
        event_type: "lead.stage_changed",
        aggregate_type: "campanha_lead",
        aggregate_id: "agg-x",
        organization_id: "org-x",
        payload: {
          lead_id: "lead-x",
          pipeline_id: null,
          campaign_id: "camp-x",
          pipe_type: null,
          old_stage_key: null,
          new_stage_key: "novo",
          pipeline_slug: null,
        },
      }),
    ).rejects.toThrow(/publishEvent failed.*rls denied/);
  });
});
