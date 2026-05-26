import { describe, it, expect, vi } from "vitest";

// Mock dependencies
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }) },
}));
vi.mock("@/modules/identity/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { organization_id: "org-1" }, isLoading: false }),
}));
vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useRealtimeSubscription: vi.fn(),
}));

import { DEFAULT_STAGES, type PipelineType } from "@/hooks/usePipelineStages";

describe("DEFAULT_STAGES", () => {
  it("has stages for all 5 pipeline types", () => {
    const types: PipelineType[] = ["whatsapp", "confirmacao", "propostas", "upsell_base", "upsell_gestao"];
    types.forEach((type) => {
      expect(DEFAULT_STAGES[type], `Missing stages for ${type}`).toBeDefined();
      expect(DEFAULT_STAGES[type].length).toBeGreaterThan(0);
    });
  });

  it("whatsapp pipeline has standard stages", () => {
    const stages = DEFAULT_STAGES.whatsapp;
    const ids = stages.map((s) => s.id);
    expect(ids).toContain("novo");
    expect(ids).toContain("abordado");
    expect(ids).toContain("respondeu");
    expect(ids).toContain("agendado");
  });

  it("every pipeline has at least one final_positive stage", () => {
    const types: PipelineType[] = ["whatsapp", "confirmacao", "propostas"];
    types.forEach((type) => {
      const positives = DEFAULT_STAGES[type].filter((s) => s.is_final_positive);
      expect(positives.length, `${type} has no positive final stage`).toBeGreaterThanOrEqual(1);
    });
  });

  it("every stage has id, title, and color", () => {
    Object.entries(DEFAULT_STAGES).forEach(([type, stages]) => {
      stages.forEach((stage) => {
        expect(stage.id, `${type} stage missing id`).toBeTruthy();
        expect(stage.title, `${type}.${stage.id} missing title`).toBeTruthy();
        expect(stage.color, `${type}.${stage.id} missing color`).toBeTruthy();
      });
    });
  });

  it("agendado stage targets confirmacao pipeline", () => {
    const agendado = DEFAULT_STAGES.whatsapp.find((s) => s.id === "agendado");
    expect(agendado?.target_pipe_type).toBe("confirmacao");
    expect(agendado?.target_stage_key).toBe("reuniao_marcada");
  });

  it("no duplicate stage IDs within a pipeline", () => {
    Object.entries(DEFAULT_STAGES).forEach(([type, stages]) => {
      const ids = stages.map((s) => s.id);
      expect(new Set(ids).size, `Duplicate IDs in ${type}`).toBe(ids.length);
    });
  });
});
