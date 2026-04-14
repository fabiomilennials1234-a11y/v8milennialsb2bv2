import { describe, it, expect } from "vitest";
import {
  QUALIFICADOR_PROMPT,
  getTemplatePromptConfig,
  generateTemplatePrompt,
} from "../../src/lib/copilot/template-prompts";

describe("QUALIFICADOR_PROMPT", () => {
  it("has type qualificador", () => {
    expect(QUALIFICADOR_PROMPT.type).toBe("qualificador");
  });

  it("has a basePrompt", () => {
    expect(QUALIFICADOR_PROMPT.basePrompt.length).toBeGreaterThan(50);
  });

  it("has methodology", () => {
    expect(QUALIFICADOR_PROMPT.methodology.length).toBeGreaterThan(100);
    expect(QUALIFICADOR_PROMPT.methodology).toContain("BANT");
  });

  it("has anti-patterns", () => {
    expect(QUALIFICADOR_PROMPT.antiPatterns.length).toBeGreaterThan(3);
    QUALIFICADOR_PROMPT.antiPatterns.forEach((ap) => {
      expect(ap).toContain("NUNCA");
    });
  });

  it("has techniques", () => {
    expect(QUALIFICADOR_PROMPT.techniques.length).toBeGreaterThan(2);
  });

  it("has human transfer triggers", () => {
    expect(QUALIFICADOR_PROMPT.humanTransferTriggers.length).toBeGreaterThan(3);
  });

  it("has intent detection rules", () => {
    expect(QUALIFICADOR_PROMPT.intentDetection.length).toBeGreaterThan(0);
  });

  it("has few-shot examples", () => {
    expect(QUALIFICADOR_PROMPT.fewShotExamples.length).toBeGreaterThan(0);
    QUALIFICADOR_PROMPT.fewShotExamples.forEach((ex) => {
      expect(ex.lead).toBeTruthy();
      expect(ex.agent).toBeTruthy();
    });
  });
});

describe("getTemplatePromptConfig", () => {
  it("returns config for qualificador", () => {
    const config = getTemplatePromptConfig("qualificador");
    expect(config).toBeDefined();
    expect(config?.type).toBe("qualificador");
  });

  it("returns config for sdr", () => {
    const config = getTemplatePromptConfig("sdr");
    expect(config).toBeDefined();
    expect(config?.type).toBe("sdr");
  });

  it("returns config for followup", () => {
    const config = getTemplatePromptConfig("followup");
    expect(config).toBeDefined();
  });

  it("returns config for agendador", () => {
    const config = getTemplatePromptConfig("agendador");
    expect(config).toBeDefined();
  });

  it("returns config for prospectador", () => {
    const config = getTemplatePromptConfig("prospectador");
    expect(config).toBeDefined();
  });

  it("returns undefined for unknown type", () => {
    const config = getTemplatePromptConfig("nonexistent" as any);
    expect(config).toBeUndefined();
  });

  it("every template config has all required fields", () => {
    const types = ["qualificador", "sdr", "followup", "agendador", "prospectador"] as const;
    types.forEach((type) => {
      const config = getTemplatePromptConfig(type);
      expect(config?.basePrompt, `${type} missing basePrompt`).toBeTruthy();
      expect(config?.methodology, `${type} missing methodology`).toBeTruthy();
      expect(config?.antiPatterns.length, `${type} missing antiPatterns`).toBeGreaterThan(0);
      expect(config?.techniques.length, `${type} missing techniques`).toBeGreaterThan(0);
    });
  });
});

describe("generateTemplatePrompt", () => {
  it("returns a non-empty string for qualificador", () => {
    const prompt = generateTemplatePrompt("qualificador");
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("includes methodology in output", () => {
    const prompt = generateTemplatePrompt("qualificador");
    expect(prompt).toContain("BANT");
  });

  it("includes anti-patterns in output", () => {
    const prompt = generateTemplatePrompt("qualificador");
    expect(prompt).toContain("NUNCA");
  });

  it("returns null/empty for unknown template", () => {
    const prompt = generateTemplatePrompt("nonexistent" as any);
    expect(!prompt || prompt === "").toBe(true);
  });

  it("all template types generate valid prompts", () => {
    const types = ["qualificador", "sdr", "followup", "agendador", "prospectador"] as const;
    types.forEach((type) => {
      const prompt = generateTemplatePrompt(type);
      expect(prompt.length, `${type} generated empty prompt`).toBeGreaterThan(100);
    });
  });
});
