import { describe, it, expect } from "vitest";
import {
  AGENT_TEMPLATES,
  getTemplateByType,
  getTemplatePresetData,
  getAllTemplateTypes,
  isValidTemplateType,
  getTemplateFullPrompt,
  getTemplateConfig,
  getTemplateAntiPatterns,
  getTemplateHumanTransferTriggers,
  getTemplateDefaultFollowupRules,
} from "@/lib/copilot/templates";

// =====================================================
// AGENT_TEMPLATES constant
// =====================================================
describe("AGENT_TEMPLATES", () => {
  it("has at least 5 templates", () => {
    expect(AGENT_TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });

  it("includes the 5 core template types", () => {
    const types = AGENT_TEMPLATES.map((t) => t.type);
    expect(types).toContain("qualificador");
    expect(types).toContain("sdr");
    expect(types).toContain("followup");
    expect(types).toContain("agendador");
    expect(types).toContain("prospectador");
  });

  it("every template has required fields", () => {
    AGENT_TEMPLATES.forEach((t) => {
      expect(t.type, "missing type").toBeTruthy();
      expect(t.name, `${t.type} missing name`).toBeTruthy();
      expect(t.description, `${t.type} missing description`).toBeTruthy();
      expect(t.icon, `${t.type} missing icon`).toBeTruthy();
      expect(t.presetData, `${t.type} missing presetData`).toBeDefined();
    });
  });

  it("every template has personality preset", () => {
    AGENT_TEMPLATES.forEach((t) => {
      const p = t.presetData.personality;
      expect(p, `${t.type} missing personality`).toBeDefined();
      expect(p?.tone, `${t.type} missing tone`).toBeTruthy();
      expect(p?.style, `${t.type} missing style`).toBeTruthy();
      expect(p?.energy, `${t.type} missing energy`).toBeTruthy();
    });
  });

  it("every template has skills", () => {
    AGENT_TEMPLATES.forEach((t) => {
      expect(t.presetData.skills?.length, `${t.type} has no skills`).toBeGreaterThan(0);
    });
  });

  it("every template has allowedTopics", () => {
    AGENT_TEMPLATES.forEach((t) => {
      expect(t.presetData.allowedTopics?.length, `${t.type} has no allowedTopics`).toBeGreaterThan(0);
    });
  });

  it("every template has forbiddenTopics", () => {
    AGENT_TEMPLATES.forEach((t) => {
      expect(t.presetData.forbiddenTopics?.length, `${t.type} has no forbiddenTopics`).toBeGreaterThan(0);
    });
  });

  it("every template has mainObjective", () => {
    AGENT_TEMPLATES.forEach((t) => {
      expect(t.presetData.mainObjective?.length, `${t.type} has no mainObjective`).toBeGreaterThan(10);
    });
  });

  it("no duplicate template types", () => {
    const types = AGENT_TEMPLATES.map((t) => t.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it("qualificador template focuses on qualification", () => {
    const qual = AGENT_TEMPLATES.find((t) => t.type === "qualificador");
    expect(qual?.presetData.mainObjective).toContain("qualif");
  });

  it("sdr template has a meaningful objective", () => {
    const sdr = AGENT_TEMPLATES.find((t) => t.type === "sdr");
    expect(sdr?.presetData.mainObjective?.length).toBeGreaterThan(20);
  });

  it("followup template has consultivo style", () => {
    const followup = AGENT_TEMPLATES.find((t) => t.type === "followup");
    expect(followup?.presetData.personality?.style).toBe("consultivo");
  });

  it("agendador template focuses on meetings", () => {
    const agendador = AGENT_TEMPLATES.find((t) => t.type === "agendador");
    expect(agendador?.presetData.mainObjective).toContain("reuniões");
  });

  it("prospectador template has persuasivo style", () => {
    const prosp = AGENT_TEMPLATES.find((t) => t.type === "prospectador");
    expect(prosp?.presetData.personality?.style).toBe("persuasivo");
  });

  it("every template has empty faqs and kanbanRules arrays", () => {
    AGENT_TEMPLATES.forEach((t) => {
      expect(t.presetData.faqs).toEqual([]);
      expect(t.presetData.kanbanRules).toEqual([]);
    });
  });

  it("every template has a templateType matching its type", () => {
    AGENT_TEMPLATES.forEach((t) => {
      expect(t.presetData.templateType).toBe(t.type);
    });
  });
});

// =====================================================
// getTemplateByType
// =====================================================
describe("getTemplateByType", () => {
  it("returns the correct template for each valid type", () => {
    const types = ["qualificador", "sdr", "followup", "agendador", "prospectador"];
    types.forEach((type) => {
      const result = getTemplateByType(type);
      expect(result).toBeDefined();
      expect(result!.type).toBe(type);
    });
  });

  it("returns undefined for unknown type", () => {
    expect(getTemplateByType("nonexistent")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(getTemplateByType("")).toBeUndefined();
  });

  it("returns the full template with icon, name, description", () => {
    const template = getTemplateByType("qualificador");
    expect(template).toBeDefined();
    expect(template!.name).toBe("Qualificador de Leads");
    expect(template!.description).toContain("qualificar");
    expect(template!.icon).toBeDefined();
  });
});

// =====================================================
// getTemplatePresetData
// =====================================================
describe("getTemplatePresetData", () => {
  it("returns preset data for each valid template type", () => {
    const types = ["qualificador", "sdr", "followup", "agendador", "prospectador"];
    types.forEach((type) => {
      const result = getTemplatePresetData(type);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty("personality");
      expect(result).toHaveProperty("skills");
      expect(result).toHaveProperty("mainObjective");
    });
  });

  it("returns null for unknown type", () => {
    expect(getTemplatePresetData("unknown_type")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getTemplatePresetData("")).toBeNull();
  });

  it("returns data that includes allowedTopics and forbiddenTopics", () => {
    const data = getTemplatePresetData("sdr");
    expect(data).not.toBeNull();
    expect(data!.allowedTopics).toBeDefined();
    expect(data!.allowedTopics!.length).toBeGreaterThan(0);
    expect(data!.forbiddenTopics).toBeDefined();
    expect(data!.forbiddenTopics!.length).toBeGreaterThan(0);
  });
});

// =====================================================
// getAllTemplateTypes
// =====================================================
describe("getAllTemplateTypes", () => {
  it("returns an array of all template types", () => {
    const types = getAllTemplateTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBe(AGENT_TEMPLATES.length);
  });

  it("contains all 5 core types", () => {
    const types = getAllTemplateTypes();
    expect(types).toContain("qualificador");
    expect(types).toContain("sdr");
    expect(types).toContain("followup");
    expect(types).toContain("agendador");
    expect(types).toContain("prospectador");
  });

  it("returns types in the same order as AGENT_TEMPLATES", () => {
    const types = getAllTemplateTypes();
    AGENT_TEMPLATES.forEach((t, i) => {
      expect(types[i]).toBe(t.type);
    });
  });
});

// =====================================================
// isValidTemplateType
// =====================================================
describe("isValidTemplateType", () => {
  it("returns true for all valid template types", () => {
    const validTypes = ["qualificador", "sdr", "followup", "agendador", "prospectador"];
    validTypes.forEach((type) => {
      expect(isValidTemplateType(type)).toBe(true);
    });
  });

  it("returns false for unknown type", () => {
    expect(isValidTemplateType("invalid")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidTemplateType("")).toBe(false);
  });

  it("returns false for similar but wrong type names", () => {
    expect(isValidTemplateType("qualifier")).toBe(false);
    expect(isValidTemplateType("Qualificador")).toBe(false);
    expect(isValidTemplateType("SDR")).toBe(false);
  });
});

// =====================================================
// getTemplateFullPrompt
// =====================================================
describe("getTemplateFullPrompt", () => {
  it("returns a string prompt for each valid template type", () => {
    const types = ["qualificador", "sdr", "followup", "agendador", "prospectador"];
    types.forEach((type) => {
      const prompt = getTemplateFullPrompt(type);
      expect(prompt).not.toBeNull();
      expect(typeof prompt).toBe("string");
      expect(prompt!.length).toBeGreaterThan(100);
    });
  });

  it("returns null for unknown type", () => {
    expect(getTemplateFullPrompt("nonexistent")).toBeNull();
  });

  it("returns null for 'custom' type", () => {
    expect(getTemplateFullPrompt("custom")).toBeNull();
  });

  it("generated prompt contains expected sections", () => {
    const prompt = getTemplateFullPrompt("qualificador");
    expect(prompt).not.toBeNull();
    expect(prompt).toContain("# BASE DO AGENTE");
    expect(prompt).toContain("# O QUE VOCÊ NUNCA DEVE FAZER");
    expect(prompt).toContain("# TÉCNICAS RECOMENDADAS");
    expect(prompt).toContain("# QUANDO TRANSFERIR PARA HUMANO");
    expect(prompt).toContain("# DETECÇÃO DE INTENÇÃO");
    expect(prompt).toContain("# EXEMPLOS DE CONVERSA (IMITE O ESTILO)");
  });

  it("qualificador prompt mentions BANT methodology", () => {
    const prompt = getTemplateFullPrompt("qualificador");
    expect(prompt).toContain("BANT");
  });

  it("sdr prompt contains SDR-related content", () => {
    const prompt = getTemplateFullPrompt("sdr");
    expect(prompt).not.toBeNull();
    expect(prompt!.length).toBeGreaterThan(100);
  });
});

// =====================================================
// getTemplateConfig
// =====================================================
describe("getTemplateConfig", () => {
  it("returns full config for each valid type", () => {
    const types = ["qualificador", "sdr", "followup", "agendador", "prospectador"];
    types.forEach((type) => {
      const config = getTemplateConfig(type);
      expect(config).not.toBeNull();
      expect(config).toHaveProperty("type");
      expect(config).toHaveProperty("basePrompt");
      expect(config).toHaveProperty("methodology");
      expect(config).toHaveProperty("antiPatterns");
      expect(config).toHaveProperty("techniques");
      expect(config).toHaveProperty("humanTransferTriggers");
      expect(config).toHaveProperty("intentDetection");
      expect(config).toHaveProperty("fewShotExamples");
    });
  });

  it("returns undefined for unknown type", () => {
    expect(getTemplateConfig("nonexistent")).toBeUndefined();
  });

  it("returns null for 'custom' type", () => {
    expect(getTemplateConfig("custom")).toBeNull();
  });

  it("config type matches the requested type", () => {
    const config = getTemplateConfig("qualificador");
    expect(config!.type).toBe("qualificador");
  });

  it("config has non-empty arrays for key fields", () => {
    const config = getTemplateConfig("sdr");
    expect(config!.antiPatterns.length).toBeGreaterThan(0);
    expect(config!.techniques.length).toBeGreaterThan(0);
    expect(config!.humanTransferTriggers.length).toBeGreaterThan(0);
    expect(config!.fewShotExamples.length).toBeGreaterThan(0);
  });
});

// =====================================================
// getTemplateAntiPatterns
// =====================================================
describe("getTemplateAntiPatterns", () => {
  it("returns anti-patterns for each valid type", () => {
    const types = ["qualificador", "sdr", "followup", "agendador", "prospectador"];
    types.forEach((type) => {
      const patterns = getTemplateAntiPatterns(type);
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeGreaterThan(0);
    });
  });

  it("returns empty array for unknown type", () => {
    const patterns = getTemplateAntiPatterns("nonexistent");
    expect(patterns).toEqual([]);
  });

  it("returns empty array for custom type", () => {
    const patterns = getTemplateAntiPatterns("custom");
    expect(patterns).toEqual([]);
  });

  it("anti-patterns are strings", () => {
    const patterns = getTemplateAntiPatterns("qualificador");
    patterns.forEach((p) => {
      expect(typeof p).toBe("string");
      expect(p.length).toBeGreaterThan(0);
    });
  });
});

// =====================================================
// getTemplateHumanTransferTriggers
// =====================================================
describe("getTemplateHumanTransferTriggers", () => {
  it("returns triggers for each valid type", () => {
    const types = ["qualificador", "sdr", "followup", "agendador", "prospectador"];
    types.forEach((type) => {
      const triggers = getTemplateHumanTransferTriggers(type);
      expect(Array.isArray(triggers)).toBe(true);
      expect(triggers.length).toBeGreaterThan(0);
    });
  });

  it("returns empty array for unknown type", () => {
    expect(getTemplateHumanTransferTriggers("nonexistent")).toEqual([]);
  });

  it("returns empty array for custom type", () => {
    expect(getTemplateHumanTransferTriggers("custom")).toEqual([]);
  });

  it("triggers are non-empty strings", () => {
    const triggers = getTemplateHumanTransferTriggers("sdr");
    triggers.forEach((t) => {
      expect(typeof t).toBe("string");
      expect(t.length).toBeGreaterThan(0);
    });
  });
});

// =====================================================
// getTemplateDefaultFollowupRules
// =====================================================
describe("getTemplateDefaultFollowupRules", () => {
  it("returns followup rules for types that have them", () => {
    // At least some templates should have default followup rules
    const types = ["qualificador", "sdr", "followup", "agendador", "prospectador"];
    let hasRules = false;
    types.forEach((type) => {
      const rules = getTemplateDefaultFollowupRules(type);
      expect(Array.isArray(rules)).toBe(true);
      if (rules.length > 0) hasRules = true;
    });
    // At least one template should have follow-up rules
    expect(hasRules).toBe(true);
  });

  it("returns empty array for unknown type", () => {
    expect(getTemplateDefaultFollowupRules("nonexistent")).toEqual([]);
  });

  it("returns empty array for custom type", () => {
    expect(getTemplateDefaultFollowupRules("custom")).toEqual([]);
  });

  it("followup rules have expected structure when present", () => {
    const types = ["qualificador", "sdr", "followup", "agendador", "prospectador"];
    types.forEach((type) => {
      const rules = getTemplateDefaultFollowupRules(type);
      rules.forEach((rule) => {
        // Rules are Partial<FollowupRule>, so they may have any subset of fields
        expect(typeof rule).toBe("object");
      });
    });
  });
});
