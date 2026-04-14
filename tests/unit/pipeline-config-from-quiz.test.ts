import { describe, it, expect } from "vitest";
import {
  generatePipelineDisplayConfig,
  type QuizAnswers,
} from "../../src/lib/pipeline-config-from-quiz";

function makeAnswers(overrides: Partial<QuizAnswers> = {}): QuizAnswers {
  return {
    perfil: { sells: "produto", segment: "industria" },
    processo: { schedules_meeting: true, uses_proposal: true },
    ...overrides,
  };
}

describe("generatePipelineDisplayConfig", () => {
  it("returns 4 pipe configs", () => {
    const config = generatePipelineDisplayConfig(makeAnswers());
    expect(config).toHaveLength(4);
  });

  it("pipe types are whatsapp, confirmacao, propostas, upsell", () => {
    const config = generatePipelineDisplayConfig(makeAnswers());
    expect(config.map((c) => c.pipe_type)).toEqual([
      "whatsapp", "confirmacao", "propostas", "upsell",
    ]);
  });

  it("positions are sequential 1-4", () => {
    const config = generatePipelineDisplayConfig(makeAnswers());
    expect(config.map((c) => c.position)).toEqual([1, 2, 3, 4]);
  });

  it("whatsapp is always visible", () => {
    const config = generatePipelineDisplayConfig(makeAnswers());
    const wpp = config.find((c) => c.pipe_type === "whatsapp");
    expect(wpp?.is_visible).toBe(true);
  });

  it("propostas is always visible", () => {
    const config = generatePipelineDisplayConfig(makeAnswers());
    const prop = config.find((c) => c.pipe_type === "propostas");
    expect(prop?.is_visible).toBe(true);
  });

  it("upsell hidden by default (no wants_carteira)", () => {
    const config = generatePipelineDisplayConfig(makeAnswers());
    const upsell = config.find((c) => c.pipe_type === "upsell");
    expect(upsell?.is_visible).toBe(false);
  });

  it("upsell visible when wants_carteira=true", () => {
    const config = generatePipelineDisplayConfig(
      makeAnswers({ processo: { wants_carteira: true } })
    );
    const upsell = config.find((c) => c.pipe_type === "upsell");
    expect(upsell?.is_visible).toBe(true);
  });

  it("confirmacao hidden when whatsapp_direto and no meetings", () => {
    const config = generatePipelineDisplayConfig(
      makeAnswers({ processo: { presentation_mode: "whatsapp_direto", schedules_meeting: false } })
    );
    const conf = config.find((c) => c.pipe_type === "confirmacao");
    expect(conf?.is_visible).toBe(false);
  });

  it("industria segment uses 'Orçamentos' for propostas", () => {
    const config = generatePipelineDisplayConfig(
      makeAnswers({ perfil: { segment: "industria" } })
    );
    const prop = config.find((c) => c.pipe_type === "propostas");
    expect(prop?.display_name).toBe("Orçamentos");
  });

  it("saas segment uses 'Propostas'", () => {
    const config = generatePipelineDisplayConfig(
      makeAnswers({ perfil: { segment: "saas" } })
    );
    const prop = config.find((c) => c.pipe_type === "propostas");
    expect(prop?.display_name).toBe("Propostas");
  });

  it("agencia segment uses 'Escopos'", () => {
    const config = generatePipelineDisplayConfig(
      makeAnswers({ perfil: { segment: "agencia" } })
    );
    const prop = config.find((c) => c.pipe_type === "propostas");
    expect(prop?.display_name).toBe("Escopos");
  });

  it("no proposal uses 'Fechamento'", () => {
    const config = generatePipelineDisplayConfig(
      makeAnswers({ processo: { uses_proposal: false } })
    );
    const prop = config.find((c) => c.pipe_type === "propostas");
    expect(prop?.display_name).toBe("Fechamento");
  });

  it("empty answers returns sensible defaults", () => {
    const config = generatePipelineDisplayConfig({});
    expect(config).toHaveLength(4);
    config.forEach((c) => {
      expect(c.display_name).toBeTruthy();
    });
  });
});
