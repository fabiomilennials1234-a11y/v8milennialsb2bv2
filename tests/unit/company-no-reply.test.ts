/**
 * Gatilho "Cliente aguardando resposta" (company_no_reply) — parte pura:
 * leitura da config (fail-closed), minutos úteis e matcher de revalidação.
 * A seleção de candidatos (o que é resposta humana, âncora, dedup, org) é
 * coberta no PGlite: tests/integration/company-no-reply-trigger.test.mjs.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_BUSINESS_HOURS,
  businessMinutesBetween,
  isWaitOverdue,
  parseCompanyNoReplyConfig,
  waitedMinutes,
} from "../../supabase/functions/_shared/company-no-reply";
import { matchesTriggerConfig } from "../../supabase/functions/_shared/workflow-trigger";
import { TRIGGER_TYPES } from "../../supabase/functions/_shared/workflow-schema/enums";
import { TRIGGER_CATEGORIES, TRIGGER_LABELS } from "../../src/types/workflow";

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
// São Paulo é UTC−3 (sem horário de verão desde 2019).
const sp = (iso: string) => Date.parse(`${iso}-03:00`);

describe("parseCompanyNoReplyConfig", () => {
  it("config vazia → 3h de relógio, qualquer funil", () => {
    expect(parseCompanyNoReplyConfig({})).toEqual({
      timeoutHours: 3, pipelineIds: [], businessHoursOnly: false, businessHours: DEFAULT_BUSINESS_HOURS,
    });
    expect(parseCompanyNoReplyConfig(null)?.timeoutHours).toBe(3);
  });

  it("aceita prazo fracionário e deduplica funis", () => {
    const cfg = parseCompanyNoReplyConfig({ timeout_hours: 0.5, pipeline_ids: [P1, P1, P2] });
    expect(cfg?.timeoutHours).toBe(0.5);
    expect(cfg?.pipelineIds).toEqual([P1, P2]);
  });

  it.each([
    ["prazo zero", { timeout_hours: 0 }],
    ["prazo negativo", { timeout_hours: -1 }],
    ["prazo abaixo de 15 min", { timeout_hours: 0.1 }],
    ["prazo não numérico", { timeout_hours: "abc" }],
    ["prazo acima de 30 dias", { timeout_hours: 24 * 31 }],
    ["funis não-lista", { pipeline_ids: P1 }],
    ["funil não-uuid", { pipeline_ids: ["whatsapp"] }],
    ["janela sem dias", { business_hours_only: true, business_hours: { days: [] } }],
    ["dia desconhecido", { business_hours_only: true, business_hours: { days: ["monday"] } }],
    ["início depois do fim", { business_hours_only: true, business_hours: { startTime: "18:00", endTime: "08:00" } }],
    ["horário malformado", { business_hours_only: true, business_hours: { startTime: "8h" } }],
    ["fuso inexistente", { business_hours_only: true, business_hours: { timezone: "Marte/Olympus" } }],
  ])("falha fechado: %s", (_name, raw) => {
    expect(parseCompanyNoReplyConfig(raw)).toBeNull();
  });

  it("horário comercial ligado sem janela usa o padrão seg–sex 08–18 SP", () => {
    const cfg = parseCompanyNoReplyConfig({ business_hours_only: true });
    expect(cfg?.businessHoursOnly).toBe(true);
    expect(cfg?.businessHours).toEqual(DEFAULT_BUSINESS_HOURS);
  });

  it("janela malformada é ignorada quando o horário comercial está desligado", () => {
    expect(parseCompanyNoReplyConfig({ business_hours: { days: [] } })?.businessHoursOnly).toBe(false);
  });
});

describe("businessMinutesBetween (seg–sex 08–18, São Paulo)", () => {
  const H = DEFAULT_BUSINESS_HOURS;

  it("dentro do mesmo dia útil conta o relógio", () => {
    expect(businessMinutesBetween(sp("2026-11-18T09:00:00"), sp("2026-11-18T12:00:00"), H)).toBe(180);
  });

  it("antes da abertura e depois do fechamento não contam", () => {
    expect(businessMinutesBetween(sp("2026-11-18T06:00:00"), sp("2026-11-18T08:30:00"), H)).toBe(30);
    expect(businessMinutesBetween(sp("2026-11-18T17:00:00"), sp("2026-11-18T23:00:00"), H)).toBe(60);
  });

  it("sexta 17h → segunda 10h = 3h úteis (fim de semana não conta)", () => {
    // 2026-11-20 é sexta.
    expect(businessMinutesBetween(sp("2026-11-20T17:00:00"), sp("2026-11-23T10:00:00"), H)).toBe(180);
  });

  it("mensagem no sábado começa a contar segunda 08h", () => {
    expect(businessMinutesBetween(sp("2026-11-21T10:00:00"), sp("2026-11-23T08:00:00"), H)).toBe(0);
    expect(businessMinutesBetween(sp("2026-11-21T10:00:00"), sp("2026-11-23T11:00:00"), H)).toBe(180);
  });

  it("vários dias úteis somam 10h por dia", () => {
    expect(businessMinutesBetween(sp("2026-11-16T08:00:00"), sp("2026-11-20T18:00:00"), H)).toBe(5 * 600);
  });

  it("intervalo vazio ou invertido = 0", () => {
    expect(businessMinutesBetween(sp("2026-11-18T12:00:00"), sp("2026-11-18T12:00:00"), H)).toBe(0);
    expect(businessMinutesBetween(sp("2026-11-18T12:00:00"), sp("2026-11-18T09:00:00"), H)).toBe(0);
  });

  it("respeita outro fuso (Manaus, UTC−4)", () => {
    const manaus = { ...H, timezone: "America/Manaus" };
    // 12:00 UTC−3 = 11:00 em Manaus; 08:00 UTC−3 = 07:00 em Manaus (antes da abertura).
    expect(businessMinutesBetween(sp("2026-11-18T08:00:00"), sp("2026-11-18T12:00:00"), manaus)).toBe(180);
  });
});

describe("isWaitOverdue / waitedMinutes", () => {
  it("relógio: 3h desde a âncora vence", () => {
    const cfg = parseCompanyNoReplyConfig({ timeout_hours: 3 })!;
    expect(isWaitOverdue(sp("2026-11-21T10:00:00"), sp("2026-11-21T13:00:00"), cfg)).toBe(true);
    expect(isWaitOverdue(sp("2026-11-21T10:00:00"), sp("2026-11-21T12:59:00"), cfg)).toBe(false);
  });

  it("horário comercial: sábado não vence até segunda 11h (caso JR Tex, 180 min úteis)", () => {
    const cfg = parseCompanyNoReplyConfig({ timeout_hours: 3, business_hours_only: true })!;
    const anchor = sp("2026-11-21T10:00:00");
    expect(isWaitOverdue(anchor, sp("2026-11-23T10:59:00"), cfg)).toBe(false);
    expect(isWaitOverdue(anchor, sp("2026-11-23T11:00:00"), cfg)).toBe(true);
    expect(waitedMinutes(anchor, sp("2026-11-23T11:00:00"), cfg)).toBe(180);
  });
});

describe("matchesTriggerConfig — company_no_reply", () => {
  it("sem filtro de funil sempre casa (prazo é decidido no disparo)", () => {
    expect(matchesTriggerConfig("company_no_reply", { timeout_hours: 3 }, {})).toBe(true);
  });

  it("com filtro: casa pelos funis congelados no context", () => {
    expect(matchesTriggerConfig("company_no_reply", { pipeline_ids: [P1] }, { lead_pipeline_ids: [P2, P1] })).toBe(true);
    expect(matchesTriggerConfig("company_no_reply", { pipeline_ids: [P1] }, { lead_pipeline_ids: [P2] })).toBe(false);
  });

  it("com filtro e sem a lista do lead → fail-closed", () => {
    expect(matchesTriggerConfig("company_no_reply", { pipeline_ids: [P1] }, {})).toBe(false);
  });
});

describe("registro do gatilho", () => {
  it("existe no enum do servidor, no rótulo e no seletor (Comunicação)", () => {
    expect(TRIGGER_TYPES).toContain("company_no_reply");
    expect(TRIGGER_LABELS.company_no_reply).toBe("Cliente Aguardando Resposta");
    const comunicacao = TRIGGER_CATEGORIES.find((c) => c.label === "Comunicação");
    expect(comunicacao?.triggers).toContain("company_no_reply");
  });
});
