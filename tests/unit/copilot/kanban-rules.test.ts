/**
 * kanban-rules — classificação e matching dos dois formatos vivos de regra
 * (SCRUM-628). Formatos medidos em prod 2026-09-02: 11 regras, todas legadas
 * (`pipe_type` slug + `stage_name` stage_key); o formato novo (uuid + uuid) é
 * o que a UI passa a gravar.
 */

import { describe, it, expect } from "vitest";
import {
  funnelRefsFromRules,
  isCampaignRule,
  isFunnelRule,
  isRetiredAxisRule,
  isUuidRef,
  ruleMatchesStage,
} from "../../../supabase/functions/_shared/copilot/kanban-rules.ts";

const UUID_PIPE = "11111111-2222-3333-4444-555555555555";
const UUID_STAGE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("isUuidRef", () => {
  it("reconhece uuid e recusa slug/stage_key", () => {
    expect(isUuidRef(UUID_PIPE)).toBe(true);
    expect(isUuidRef("whatsapp")).toBe(false);
    expect(isUuidRef("novo_lead")).toBe(false);
    expect(isUuidRef("")).toBe(false);
    expect(isUuidRef(null)).toBe(false);
  });
});

describe("classificação de eixos", () => {
  it("campanha é eixo próprio, não funil", () => {
    const rule = { pipe_type: "campanha", stage_name: "Etapa 1" };
    expect(isCampaignRule(rule)).toBe(true);
    expect(isFunnelRule(rule)).toBe(false);
  });

  it("upsell_* está aposentado (Carteira não é funil — SCRUM-618)", () => {
    const rule = { pipe_type: "upsell_base", stage_name: "ativo" };
    expect(isRetiredAxisRule(rule)).toBe(true);
    expect(isFunnelRule(rule)).toBe(false);
  });

  it("slug legado e uuid são ambos regra de funil", () => {
    expect(isFunnelRule({ pipe_type: "whatsapp", stage_name: "novo" })).toBe(true);
    expect(isFunnelRule({ pipe_type: UUID_PIPE, stage_name: UUID_STAGE })).toBe(true);
  });
});

describe("funnelRefsFromRules", () => {
  it("devolve refs distintas na ordem, ignorando campanha e eixos aposentados", () => {
    const refs = funnelRefsFromRules([
      { pipe_type: "whatsapp", stage_name: "novo" },
      { pipe_type: "campanha", stage_name: "x" },
      { pipe_type: UUID_PIPE, stage_name: UUID_STAGE },
      { pipe_type: "whatsapp", stage_name: "abordado" },
      { pipe_type: "upsell_gestao", stage_name: "y" },
    ]);
    expect(refs).toEqual(["whatsapp", UUID_PIPE]);
  });

  it("tolera lista ausente/vazia e regra malformada", () => {
    expect(funnelRefsFromRules(undefined)).toEqual([]);
    expect(funnelRefsFromRules([])).toEqual([]);
    expect(funnelRefsFromRules([{ pipe_type: "", stage_name: "a" }, null as never])).toEqual([]);
  });
});

describe("ruleMatchesStage", () => {
  it("formato legado casa por stage_key, case-insensitive (comportamento histórico)", () => {
    const rule = { pipe_type: "whatsapp", stage_name: "Novo_Lead" };
    expect(ruleMatchesStage(rule, { id: UUID_STAGE, key: "novo_lead" })).toBe(true);
    expect(ruleMatchesStage(rule, { id: UUID_STAGE, key: "outro" })).toBe(false);
  });

  it("formato novo casa por uuid da etapa, nunca por key", () => {
    const rule = { pipe_type: UUID_PIPE, stage_name: UUID_STAGE };
    expect(ruleMatchesStage(rule, { id: UUID_STAGE, key: "qualquer" })).toBe(true);
    expect(ruleMatchesStage(rule, { id: "outra-coisa", key: UUID_STAGE })).toBe(false);
    // entry sem stage_id (fantasma tolerado no W1) não casa regra-uuid
    expect(ruleMatchesStage(rule, { id: null, key: "novo" })).toBe(false);
  });
});
