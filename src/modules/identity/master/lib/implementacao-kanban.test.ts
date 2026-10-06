import { describe, expect, it } from "vitest";
import {
  canAdvance,
  checklistDone,
  daysInStage,
  isStale,
  nextStage,
  type ImplementacaoFacts,
  type ImplementacaoGates,
} from "./implementacao-kanban";

const gates = (over: Partial<ImplementacaoGates> = {}): ImplementacaoGates => ({
  has_plan: false,
  whatsapp_connected: false,
  pipelines_total: 0,
  pipelines_won_lost: 0,
  first_sale: false,
  checklist: null,
  ...over,
});
const item = (over: Partial<ImplementacaoFacts> = {}): ImplementacaoFacts => ({
  stage: "cliente_novo",
  owner_master_user_id: null,
  stage_entered_at: "2026-10-01T00:00:00Z",
  gates: gates(),
  ...over,
});

describe("IM-2: sai de Cliente novo só com plano e responsável", () => {
  it("sem nenhum dos dois, diz os dois", () => {
    const v = canAdvance(item(), "construcao");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.missing.map((m) => m.label)).toEqual(["Plano definido", "Responsável definido"]);
  });
  it("só com plano ainda trava", () => {
    expect(canAdvance(item({ gates: gates({ has_plan: true }) }), "construcao").ok).toBe(false);
  });
  it("com os dois, passa", () => {
    expect(canAdvance(item({ owner_master_user_id: "m1", gates: gates({ has_plan: true }) }), "construcao").ok).toBe(true);
  });
});

describe("IM-3: Call só com o básico pronto", () => {
  const base = item({ stage: "construcao" });
  it("sem funil nenhum não passa, mesmo com WhatsApp", () => {
    expect(canAdvance({ ...base, gates: gates({ whatsapp_connected: true }) }, "call").ok).toBe(false);
  });
  it("um funil sem ganho/perda trava", () => {
    const v = canAdvance(
      { ...base, gates: gates({ whatsapp_connected: true, pipelines_total: 2, pipelines_won_lost: 1 }) },
      "call",
    );
    expect(v.ok).toBe(false);
  });
  it("WhatsApp desconectado trava", () => {
    expect(canAdvance({ ...base, gates: gates({ pipelines_total: 1, pipelines_won_lost: 1 }) }, "call").ok).toBe(false);
  });
  it("tudo pronto, passa", () => {
    expect(
      canAdvance({ ...base, gates: gates({ whatsapp_connected: true, pipelines_total: 2, pipelines_won_lost: 2 }) }, "call")
        .ok,
    ).toBe(true);
  });
});

describe("IM-4: Concluído só com a 1ª venda", () => {
  it("sem venda trava, com venda passa", () => {
    expect(canAdvance(item({ stage: "call" }), "concluido").ok).toBe(false);
    expect(canAdvance(item({ stage: "call", gates: gates({ first_sale: true }) }), "concluido").ok).toBe(true);
  });
});

describe("movimento", () => {
  it("não pula etapa", () => {
    expect(canAdvance(item({ gates: gates({ first_sale: true }) }), "call").ok).toBe(false);
  });
  it("voltar é permitido", () => {
    expect(canAdvance(item({ stage: "call" }), "construcao").ok).toBe(true);
  });
  it("concluído não sai", () => {
    expect(canAdvance(item({ stage: "concluido" }), "call").ok).toBe(false);
  });
  it("nextStage", () => {
    expect(nextStage("cliente_novo")).toBe("construcao");
    expect(nextStage("concluido")).toBeNull();
  });
});

describe("IM-5: mais de 7 dias na mesma etapa", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  it("8 dias alerta, 7 não", () => {
    expect(daysInStage(item(), now)).toBe(8);
    expect(isStale(item(), now)).toBe(true);
    expect(isStale(item({ stage_entered_at: "2026-10-02T13:00:00Z" }), now)).toBe(false);
  });
  it("concluído nunca alerta", () => {
    expect(isStale(item({ stage: "concluido" }), now)).toBe(false);
  });
});

describe("IM-6: checklist de 6 passos", () => {
  it("conta os feitos; sem linha é zero", () => {
    expect(checklistDone(gates())).toBe(0);
    expect(
      checklistDone(
        gates({ checklist: { whatsapp: true, lead: true, copilot: false, automacao: false, membro: true, venda: false } }),
      ),
    ).toBe(3);
  });
});
