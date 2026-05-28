import { describe, it, expect } from "vitest";
import { generateSuggestions } from "../../src/modules/platform/lib/onboarding-suggestions";

describe("generateSuggestions", () => {
  it("returns pipelines, automations, profileLabel and checklistPriorities", () => {
    const result = generateSuggestions({});
    expect(result).toHaveProperty("pipelines");
    expect(result).toHaveProperty("automations");
    expect(result).toHaveProperty("profileLabel");
    expect(result).toHaveProperty("checklistPriorities");
    expect(Array.isArray(result.pipelines)).toBe(true);
    expect(Array.isArray(result.automations)).toBe(true);
  });

  it("SDR + Closer team generates 2 pipelines", () => {
    const result = generateSuggestions({
      estrutura: { has_sdr: true, has_closer: true },
    });
    expect(result.pipelines.length).toBe(2);
    expect(result.pipelines[0].name).toContain("Qualificação");
    expect(result.pipelines[1].name).toContain("Fechamento");
  });

  it("WhatsApp direct without meetings generates single pipeline", () => {
    const result = generateSuggestions({
      processo: { presentation_mode: "whatsapp_direto", schedules_meeting: false },
    });
    expect(result.pipelines.length).toBeGreaterThanOrEqual(1);
    expect(result.pipelines[0].name).toContain("WhatsApp");
  });

  it("every pipeline has stages with required fields", () => {
    const result = generateSuggestions({
      estrutura: { has_sdr: true, has_closer: true },
      processo: { uses_proposal: true, schedules_meeting: true },
    });
    result.pipelines.forEach((pipe) => {
      expect(pipe.name).toBeTruthy();
      expect(pipe.stages.length).toBeGreaterThan(0);
      pipe.stages.forEach((stage) => {
        expect(stage.name).toBeTruthy();
        expect(stage.color).toBeTruthy();
        expect(typeof stage.is_final_positive).toBe("boolean");
        expect(typeof stage.is_final_negative).toBe("boolean");
      });
    });
  });

  it("every pipeline has exactly one positive final stage", () => {
    const result = generateSuggestions({
      estrutura: { has_sdr: true, has_closer: true },
    });
    result.pipelines.forEach((pipe) => {
      const positives = pipe.stages.filter((s) => s.is_final_positive);
      expect(positives.length).toBe(1);
    });
  });

  it("every pipeline has exactly one negative final stage", () => {
    const result = generateSuggestions({
      estrutura: { has_sdr: true, has_closer: true },
    });
    result.pipelines.forEach((pipe) => {
      const negatives = pipe.stages.filter((s) => s.is_final_negative);
      expect(negatives.length).toBe(1);
    });
  });

  it("industry segment uses correct naming", () => {
    const result = generateSuggestions({
      perfil: { segment: "industria" },
      processo: { uses_proposal: true, schedules_meeting: true },
    });
    const allStageNames = result.pipelines.flatMap((p) => p.stages.map((s) => s.name));
    // Industry uses "Orçamento" or "Visita" terminology
    expect(allStageNames.some((n) => n.includes("Visita") || n.includes("Orçamento") || n.includes("Pedido"))).toBe(true);
  });

  it("empty answers returns at least 1 pipeline", () => {
    const result = generateSuggestions({});
    expect(result.pipelines.length).toBeGreaterThanOrEqual(1);
  });
});
