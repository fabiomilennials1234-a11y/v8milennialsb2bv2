/**
 * Fix #23 (SP-0) — TV Dashboard KPI label honesty.
 * Ver docs/superpowers/specs/2026-07-02-metrics-foundation-design.md
 *
 * Guards contra dois labels que MENTIAM pro gestor na TV:
 *   1. "Base Ativa" era um placeholder hardcoded 0 (useTVKPIs.base_ativa) —
 *      não pode renderizar como se fosse dado. Removido do pool de KPIs.
 *   2. "Respostas" na verdade contava o stage "abordado" do kanban, não
 *      respostas reais de conversation_messages. Rotulado como "Leads Abordados"
 *      até SP-3 ligar as replies reais.
 *
 * O util de mapeamento de label é generateTVConfig() — testado diretamente,
 * sem precisar montar o hook nem o DOM.
 */
import { describe, it, expect } from "vitest";
import { generateTVConfig } from "@/modules/platform/lib/tv-config-from-quiz";
import type { OnboardingAnswers } from "@/modules/platform/hooks/useOnboarding";

// Cartesian de todas as combinações que afetam a montagem de KPIs.
function buildAnswers(
  hasSdr: boolean,
  schedulesMeeting: boolean,
  usesProposal: boolean,
  wantsCarteira: boolean,
  whatsappDirect: boolean,
): OnboardingAnswers {
  return {
    perfil: { segment: "industria" },
    estrutura: { has_sdr: hasSdr },
    processo: {
      schedules_meeting: schedulesMeeting,
      uses_proposal: usesProposal,
      wants_carteira: wantsCarteira,
      presentation_mode: whatsappDirect ? "whatsapp_direto" : "reuniao",
    },
  };
}

const ALL_CONFIGS = [
  // default (sem respostas do quiz) exercita DEFAULT_CONFIG
  generateTVConfig(null),
  generateTVConfig(undefined),
  // matriz completa das flags relevantes
  ...[true, false].flatMap((hasSdr) =>
    [true, false].flatMap((sched) =>
      [true, false].flatMap((prop) =>
        [true, false].flatMap((cart) =>
          [true, false].map((wa) =>
            generateTVConfig(buildAnswers(hasSdr, sched, prop, cart, wa)),
          ),
        ),
      ),
    ),
  ),
];

describe("generateTVConfig — Fix #23 label honesty", () => {
  it("nunca rotula um KPI como 'Respostas' (era o stage 'abordado' disfarçado)", () => {
    for (const cfg of ALL_CONFIGS) {
      expect(cfg.kpis.map((k) => k.label)).not.toContain("Respostas");
    }
  });

  it("o KPI derivado de 'abordado' (key 'respostas') é rotulado 'Leads Abordados'", () => {
    // Org WhatsApp-direto é o caminho que injeta o KPI de key "respostas".
    const cfg = generateTVConfig(
      buildAnswers(/*sdr*/ false, /*sched*/ false, /*prop*/ true, /*cart*/ false, /*wa*/ true),
    );
    const respostasKpi = cfg.kpis.find((k) => k.key === "respostas");
    expect(respostasKpi).toBeDefined();
    expect(respostasKpi!.label).toBe("Leads Abordados");
    expect(respostasKpi!.label).not.toBe("Respostas");
  });

  it("em toda config, se existir key 'respostas' o label é 'Leads Abordados' (nunca 'Respostas')", () => {
    for (const cfg of ALL_CONFIGS) {
      for (const kpi of cfg.kpis) {
        if (kpi.key === "respostas") {
          expect(kpi.label).toBe("Leads Abordados");
        }
      }
    }
  });

  it("nunca renderiza o KPI 'base_ativa' (era placeholder hardcoded 0)", () => {
    for (const cfg of ALL_CONFIGS) {
      expect(cfg.kpis.map((k) => k.key)).not.toContain("base_ativa");
      expect(cfg.kpis.map((k) => k.label)).not.toContain("Base Ativa");
    }
  });

  it("org com carteira recebe 'Leads p/ Trabalhar' (dado real) no lugar de 'Base Ativa'", () => {
    const cfg = generateTVConfig(
      buildAnswers(/*sdr*/ true, /*sched*/ true, /*prop*/ true, /*cart*/ true, /*wa*/ false),
    );
    expect(cfg.kpis.map((k) => k.key)).not.toContain("base_ativa");
    expect(cfg.kpis.map((k) => k.key)).toContain("leads");
  });
});
