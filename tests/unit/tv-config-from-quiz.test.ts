import { describe, it, expect } from "vitest";
import { generateTVConfig } from "../../src/modules/platform/lib/tv-config-from-quiz";

describe("generateTVConfig", () => {
  it("returns default config when no answers", () => {
    const config = generateTVConfig(null);
    expect(config.kpis.length).toBe(6);
    expect(config.showFunnel).toBe(true);
    expect(config.showHotProposals).toBe(true);
    expect(config.showMonthlySales).toBe(true);
    expect(config.showRanking).toBe(true);
    expect(config.salesLabel).toBe("Vendas");
  });

  it("returns default config when undefined", () => {
    const config = generateTVConfig(undefined);
    expect(config.kpis.length).toBe(6);
  });

  it("SDR + meetings shows reunioes and noshow KPIs", () => {
    const config = generateTVConfig({
      estrutura: { has_sdr: true },
      processo: { schedules_meeting: true },
    } as any);
    const keys = config.kpis.map((k) => k.key);
    expect(keys).toContain("reunioes");
    expect(keys).toContain("noshow");
  });

  it("WhatsApp direct shows leads_novos and respostas", () => {
    const config = generateTVConfig({
      processo: { presentation_mode: "whatsapp_direto" },
    } as any);
    const keys = config.kpis.map((k) => k.key);
    expect(keys).toContain("leads_novos");
    expect(keys).toContain("respostas");
  });

  it("always includes conversao KPI", () => {
    const config = generateTVConfig({} as any);
    const keys = config.kpis.map((k) => k.key);
    expect(keys).toContain("conversao");
  });

  it("uses_proposal adds propostas KPI", () => {
    const config = generateTVConfig({
      processo: { uses_proposal: true },
    } as any);
    const keys = config.kpis.map((k) => k.key);
    expect(keys).toContain("propostas");
  });

  it("wants_carteira shows base_ativa instead of leads", () => {
    const config = generateTVConfig({
      processo: { wants_carteira: true },
    } as any);
    const keys = config.kpis.map((k) => k.key);
    expect(keys).toContain("base_ativa");
    expect(config.showCarteira).toBe(true);
  });

  it("always has exactly 6 KPIs (fills from fallback pool)", () => {
    const config = generateTVConfig({} as any);
    expect(config.kpis.length).toBe(6);
  });

  it("no duplicate KPIs", () => {
    const config = generateTVConfig({
      estrutura: { has_sdr: true },
      processo: { schedules_meeting: true, uses_proposal: true, wants_carteira: true },
    } as any);
    const keys = config.kpis.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("showFunnel false when whatsapp_direto", () => {
    const config = generateTVConfig({
      processo: { presentation_mode: "whatsapp_direto" },
    } as any);
    expect(config.showFunnel).toBe(false);
  });

  it("showHotProposals false when no proposal", () => {
    const config = generateTVConfig({
      processo: { uses_proposal: false },
    } as any);
    expect(config.showHotProposals).toBe(false);
  });

  it("industria segment uses Orçamentos label", () => {
    const config = generateTVConfig({
      perfil: { segment: "industria" },
    } as any);
    expect(config.proposalLabel).toBe("Orçamentos");
  });

  it("agencia segment uses Escopos label", () => {
    const config = generateTVConfig({
      perfil: { segment: "agencia" },
    } as any);
    expect(config.proposalLabel).toBe("Escopos");
  });

  it("no proposal uses Fechamentos label", () => {
    const config = generateTVConfig({
      processo: { uses_proposal: false },
    } as any);
    expect(config.proposalLabel).toBe("Fechamentos");
  });

  it("whatsapp_direto uses Pipeline as funnel label", () => {
    const config = generateTVConfig({
      processo: { presentation_mode: "whatsapp_direto" },
    } as any);
    expect(config.funnelLabel).toBe("Pipeline");
  });

  it("every KPI has key, label, and color", () => {
    const config = generateTVConfig({} as any);
    config.kpis.forEach((kpi) => {
      expect(kpi.key).toBeTruthy();
      expect(kpi.label).toBeTruthy();
      expect(kpi.color).toBeTruthy();
    });
  });
});
