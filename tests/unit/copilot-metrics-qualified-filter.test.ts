import { describe, expect, it } from "vitest";
import {
  QUALIFIED_TIER_FILTER,
  QUALIFIED_TIERS,
  isQualifiedLead,
} from "@/modules/copilot/lib/qualified-leads-filter";

/**
 * Métricas LLM › "Taxa de Qualificação" deixou de ler `qualification_score`
 * (CTO, 02/10). A régua é a de "Boas avaliações" do Estúdio:
 * COALESCE(qualification_tier, pre_qualification_tier) ∈ {prata, ouro, diamante}.
 */
describe("filtro de lead qualificado das Métricas LLM", () => {
  it("usa exatamente os tiers bons da régua do funil", () => {
    expect([...QUALIFIED_TIERS].sort()).toEqual(["diamante", "ouro", "prata"]);
  });

  it("monta a disjunção equivalente ao COALESCE, sem score", () => {
    expect(QUALIFIED_TIER_FILTER).toBe(
      "qualification_tier.in.(prata,ouro,diamante),and(qualification_tier.is.null,pre_qualification_tier.in.(prata,ouro,diamante))",
    );
    expect(QUALIFIED_TIER_FILTER).not.toMatch(/score/);
  });

  it("vale a do vendedor; sem ela, a pré-qualificação", () => {
    expect(isQualifiedLead({ qualification_tier: "ouro", pre_qualification_tier: null })).toBe(true);
    expect(isQualifiedLead({ qualification_tier: null, pre_qualification_tier: "prata" })).toBe(true);
    // Vendedor rebaixou: a pré-qualificação boa não salva.
    expect(isQualifiedLead({ qualification_tier: "bronze", pre_qualification_tier: "diamante" })).toBe(false);
    expect(isQualifiedLead({ qualification_tier: "desqualificado", pre_qualification_tier: null })).toBe(false);
    expect(isQualifiedLead({ qualification_tier: null, pre_qualification_tier: null })).toBe(false);
  });
});
