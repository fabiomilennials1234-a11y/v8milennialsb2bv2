import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Supabase chain mock — captura insert/update args por tabela.
// ---------------------------------------------------------------------------
const calls: { table: string; op: string; payload: unknown }[] = [];
let existingEntry: { id: string } | null = null;

function makeChain(table: string) {
  const chain: Record<string, any> = {};
  ["select", "eq"].forEach((m) => (chain[m] = vi.fn().mockReturnValue(chain)));
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: existingEntry, error: null });
  chain.insert = vi.fn((payload: unknown) => {
    calls.push({ table, op: "insert", payload });
    return chain;
  });
  chain.update = vi.fn((payload: unknown) => {
    calls.push({ table, op: "update", payload });
    return chain;
  });
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => makeChain(table) },
}));

import { upsertLeadIntoCustomPipe } from "@/modules/pipelines/lib/stageTransition";

describe("upsertLeadIntoCustomPipe", () => {
  beforeEach(() => {
    calls.length = 0;
    existingEntry = null;
  });

  it("insere nova entry quando o lead ainda não está no funil destino", async () => {
    existingEntry = null;

    await upsertLeadIntoCustomPipe({
      leadId: "lead-1",
      organizationId: "org-1",
      targetPipelineId: "pipe-X",
      targetStageId: "stage-Y",
    });

    const insert = calls.find((c) => c.op === "insert");
    expect(insert).toBeTruthy();
    expect(insert!.table).toBe("custom_pipe_entries");
    expect(insert!.payload).toMatchObject({
      lead_id: "lead-1",
      organization_id: "org-1",
      pipeline_id: "pipe-X",
      stage_id: "stage-Y",
    });
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("move a entry existente (sem duplicar) quando o lead já está no funil destino", async () => {
    existingEntry = { id: "entry-99" };

    await upsertLeadIntoCustomPipe({
      leadId: "lead-1",
      organizationId: "org-1",
      targetPipelineId: "pipe-X",
      targetStageId: "stage-Z",
    });

    const update = calls.find((c) => c.op === "update");
    expect(update).toBeTruthy();
    expect(update!.table).toBe("custom_pipe_entries");
    expect(update!.payload).toMatchObject({ stage_id: "stage-Z" });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });
});
