import { describe, it, expect, vi } from "vitest";

// Mock dependencies
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }) },
}));
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { organization_id: "org-1" }, isLoading: false }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({
  useRealtimeSubscription: vi.fn(),
}));

import { FALLBACK_STAGES } from "@/modules/pipelines/hooks/model/usePipelineStages";
import { FUNIL_DE_VENDAS_STAGES } from "@/contracts/pipe";

/**
 * SCRUM-641: o antigo `DEFAULT_STAGES` (Record com o trio
 * whatsapp/confirmacao/propostas) morreu — funil é funil (ADR-0034 D1), e o
 * fallback de exibição é UMA trilha, espelho do funil de fábrica.
 */
describe("FALLBACK_STAGES (trilha única, SCRUM-641)", () => {
  it("é a trilha do Funil de Vendas: novo → em_conversa → reuniao_marcada → proposta_enviada → ganhou → perdeu", () => {
    expect(FALLBACK_STAGES.map((s) => s.id)).toEqual([
      "novo",
      "em_conversa",
      "reuniao_marcada",
      "proposta_enviada",
      "ganhou",
      "perdeu",
    ]);
  });

  it("espelha FUNIL_DE_VENDAS_STAGES (nomes, cores e flags finais)", () => {
    expect(FALLBACK_STAGES.map((s) => ({
      name: s.title,
      color: s.color,
      is_final_positive: s.is_final_positive ?? false,
      is_final_negative: s.is_final_negative ?? false,
    }))).toEqual([...FUNIL_DE_VENDAS_STAGES]);
  });

  it("tem exatamente um final positivo (ganhou) e um final negativo (perdeu)", () => {
    expect(FALLBACK_STAGES.filter((s) => s.is_final_positive).map((s) => s.id)).toEqual(["ganhou"]);
    expect(FALLBACK_STAGES.filter((s) => s.is_final_negative).map((s) => s.id)).toEqual(["perdeu"]);
  });

  it("toda etapa tem id, title e color; ids únicos; sem alvo de transição entre funis", () => {
    const ids = FALLBACK_STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    FALLBACK_STAGES.forEach((stage) => {
      expect(stage.id).toBeTruthy();
      expect(stage.title).toBeTruthy();
      expect(stage.color).toBeTruthy();
      // O trio tinha target_pipe_type (agendado → confirmacao etc.). A trilha
      // única não aponta para funil nenhum — reintroduzir slug aqui é regressão.
      expect(stage.target_pipe_type).toBeUndefined();
      expect(stage.target_stage_key).toBeUndefined();
    });
  });

  it("não menciona os slugs do trio legado em lugar nenhum", () => {
    const dump = JSON.stringify(FALLBACK_STAGES);
    expect(dump).not.toMatch(/whatsapp|confirmacao|propostas|upsell/);
  });
});
