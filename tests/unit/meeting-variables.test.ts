import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calendarDaysUntil,
  formatMeetingDay,
  formatMeetingHour,
  findNextMeeting,
  meetingTemplateVariables,
  daysUntilNextMeeting,
} from "../../supabase/functions/_shared/meeting-variables";

// Todas as datas em UTC; São Paulo = UTC-3 (sem horário de verão desde 2019).
// Terça, 24/11/2026, 10:00 em SP.
const NOW = new Date("2026-11-24T13:00:00Z");

describe("meeting-variables — formatMeetingHour()", () => {
  it("hora cheia vira '15h'", () => {
    expect(formatMeetingHour(new Date("2026-11-26T18:00:00Z"))).toBe("15h");
  });
  it("hora quebrada vira '15h30'", () => {
    expect(formatMeetingHour(new Date("2026-11-26T18:30:00Z"))).toBe("15h30");
  });
  it("manhã sem zero à esquerda: '9h'", () => {
    expect(formatMeetingHour(new Date("2026-11-26T12:00:00Z"))).toBe("9h");
  });
  it("meia-noite em SP: '0h'", () => {
    expect(formatMeetingHour(new Date("2026-11-27T03:00:00Z"))).toBe("0h");
  });
  it("minuto com um dígito ganha zero: '8h05'", () => {
    expect(formatMeetingHour(new Date("2026-11-26T11:05:00Z"))).toBe("8h05");
  });
});

describe("meeting-variables — calendarDaysUntil()", () => {
  it("mesmo dia em SP = 0", () => {
    expect(calendarDaysUntil(new Date("2026-11-24T20:00:00Z"), NOW)).toBe(0);
  });
  it("conta dia de calendário em SP, não 24h corridas", () => {
    // Agora 23:30 SP de terça; reunião 00:30 SP de quarta = 1 dia, 1h depois.
    const lateNight = new Date("2026-11-25T02:30:00Z");
    expect(calendarDaysUntil(new Date("2026-11-25T03:30:00Z"), lateNight)).toBe(1);
  });
  it("sexta a partir de terça = 3", () => {
    expect(calendarDaysUntil(new Date("2026-11-27T18:00:00Z"), NOW)).toBe(3);
  });
  it("UTC já virou mas SP não: continua 0", () => {
    // 22:00 SP de terça = 01:00Z de quarta.
    expect(calendarDaysUntil(new Date("2026-11-25T01:00:00Z"), NOW)).toBe(0);
  });
});

describe("meeting-variables — formatMeetingDay()", () => {
  it("hoje", () => {
    expect(formatMeetingDay(new Date("2026-11-24T18:00:00Z"), NOW)).toBe("hoje");
  });
  it("amanhã", () => {
    expect(formatMeetingDay(new Date("2026-11-25T18:00:00Z"), NOW)).toBe("amanhã");
  });
  it("dentro da semana: nome do dia sem '-feira'", () => {
    expect(formatMeetingDay(new Date("2026-11-26T18:00:00Z"), NOW)).toBe("quinta");
    expect(formatMeetingDay(new Date("2026-11-27T18:00:00Z"), NOW)).toBe("sexta");
    expect(formatMeetingDay(new Date("2026-11-28T18:00:00Z"), NOW)).toBe("sábado");
    expect(formatMeetingDay(new Date("2026-11-29T18:00:00Z"), NOW)).toBe("domingo");
    expect(formatMeetingDay(new Date("2026-11-30T18:00:00Z"), NOW)).toBe("segunda");
  });
  it("7 dias ou mais: nome do dia + data, para não confundir com esta semana", () => {
    expect(formatMeetingDay(new Date("2026-12-01T18:00:00Z"), NOW)).toBe("terça, 01/12");
    expect(formatMeetingDay(new Date("2026-12-10T18:00:00Z"), NOW)).toBe("quinta, 10/12");
  });
});

// ── Fake mínimo do PostgREST: grava filtros e devolve as linhas que casam. ──
type Row = {
  id: string;
  organization_id: string;
  lead_id: string;
  pipeline_entry_id: string | null;
  event_type: string;
  status: string;
  start_at: string;
};

function fakeSupabase(rows: Row[], opts: { error?: boolean } = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const build = () => {
    let filtered = [...rows];
    type Q = {
      select: (...a: unknown[]) => Q;
      eq: (col: keyof Row, v: unknown) => Q;
      gte: (col: keyof Row, v: string) => Q;
      order: (col: keyof Row, o: { ascending: boolean }) => Q;
      limit: (n: number) => Promise<{ data: Row[] | null; error: { message: string } | null }>;
    };
    const q: Q = {
      select: (...a: unknown[]) => { calls.push(["select", ...a]); return q; },
      eq: (col: keyof Row, v: unknown) => { calls.push(["eq", col, v]); filtered = filtered.filter((r) => r[col] === v); return q; },
      gte: (col: keyof Row, v: string) => { calls.push(["gte", col, v]); filtered = filtered.filter((r) => String(r[col]) >= v); return q; },
      order: (col: keyof Row, o: { ascending: boolean }) => {
        calls.push(["order", col, o]);
        filtered.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (o.ascending ? 1 : -1));
        return q;
      },
      limit: (n: number) => {
        calls.push(["limit", n]);
        return Promise.resolve(opts.error
          ? { data: null, error: { message: "boom" } }
          : { data: filtered.slice(0, n), error: null });
      },
    };
    return q;
  };
  const client = { from: (t: string) => { calls.push(["from", t]); return build(); } } as unknown as SupabaseClient;
  return { client, calls };
}

const ORG = "org-1";
const LEAD = "lead-1";
const base = { organization_id: ORG, lead_id: LEAD, event_type: "meeting", status: "scheduled" };

describe("meeting-variables — findNextMeeting()", () => {
  it("prefere a reunião do negócio que disparou, mesmo que outra seja antes", async () => {
    const { client } = fakeSupabase([
      { ...base, id: "outro-negocio", pipeline_entry_id: "entry-2", start_at: "2026-11-25T12:00:00.000Z" },
      { ...base, id: "deste-negocio", pipeline_entry_id: "entry-1", start_at: "2026-11-27T18:00:00.000Z" },
    ]);
    const m = await findNextMeeting(client, { leadId: LEAD, organizationId: ORG, entryId: "entry-1" }, NOW);
    expect(m?.id).toBe("deste-negocio");
  });

  it("sem reunião do negócio: cai para a próxima do lead", async () => {
    const { client } = fakeSupabase([
      { ...base, id: "b", pipeline_entry_id: null, start_at: "2026-11-28T18:00:00.000Z" },
      { ...base, id: "a", pipeline_entry_id: null, start_at: "2026-11-26T18:00:00.000Z" },
    ]);
    const m = await findNextMeeting(client, { leadId: LEAD, organizationId: ORG, entryId: "entry-1" }, NOW);
    expect(m?.id).toBe("a");
  });

  it("ignora passada, cancelada, no-show e evento que não é reunião", async () => {
    const { client } = fakeSupabase([
      { ...base, id: "passada", pipeline_entry_id: null, start_at: "2026-11-20T18:00:00.000Z" },
      { ...base, id: "cancelada", status: "cancelled", pipeline_entry_id: null, start_at: "2026-11-26T18:00:00.000Z" },
      { ...base, id: "noshow", status: "no_show", pipeline_entry_id: null, start_at: "2026-11-26T18:00:00.000Z" },
      { ...base, id: "call", event_type: "call", pipeline_entry_id: null, start_at: "2026-11-26T18:00:00.000Z" },
    ]);
    expect(await findNextMeeting(client, { leadId: LEAD, organizationId: ORG, entryId: null }, NOW)).toBeNull();
  });

  it("isola por organização: reunião de outra org com o mesmo lead_id não vaza", async () => {
    const { client, calls } = fakeSupabase([
      { ...base, organization_id: "org-2", id: "alheia", pipeline_entry_id: null, start_at: "2026-11-26T18:00:00.000Z" },
    ]);
    expect(await findNextMeeting(client, { leadId: LEAD, organizationId: ORG, entryId: null }, NOW)).toBeNull();
    expect(calls).toContainEqual(["eq", "organization_id", ORG]);
  });

  it("erro do banco vira ausência (null), nunca exceção", async () => {
    const { client } = fakeSupabase([], { error: true });
    expect(await findNextMeeting(client, { leadId: LEAD, organizationId: ORG, entryId: null }, NOW)).toBeNull();
  });
});

describe("meeting-variables — meetingTemplateVariables()", () => {
  const rows: Row[] = [{ ...base, id: "m", pipeline_entry_id: "entry-1", start_at: "2026-11-27T18:00:00.000Z" }];

  it("resolve dia e hora juntos, no formato do balão 'sexta às 15h'", async () => {
    const { client } = fakeSupabase(rows);
    const vars = await meetingTemplateVariables(
      client, "pra {{dia_reuniao}} às {{hora_reuniao}}", { leadId: LEAD, organizationId: ORG, entryId: "entry-1" }, NOW,
    );
    expect(vars).toEqual({ dia_reuniao: "sexta", hora_reuniao: "15h", data_reuniao: "27/11/2026" });
  });

  it("template sem variável de reunião não consulta o banco", async () => {
    const { client, calls } = fakeSupabase(rows);
    expect(await meetingTemplateVariables(client, "Oi {{primeiro_nome}}", { leadId: LEAD, organizationId: ORG, entryId: null }, NOW)).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it("sem reunião: variáveis vazias (a mensagem não sai com {{placeholder}} cru)", async () => {
    const { client } = fakeSupabase([]);
    const vars = await meetingTemplateVariables(client, "{{dia_reuniao}} {{hora_reuniao}}", { leadId: LEAD, organizationId: ORG, entryId: null }, NOW);
    expect(vars).toEqual({ dia_reuniao: "", hora_reuniao: "", data_reuniao: "" });
  });
});

describe("meeting-variables — daysUntilNextMeeting()", () => {
  it("dias de calendário até a reunião do negócio", async () => {
    const { client } = fakeSupabase([{ ...base, id: "m", pipeline_entry_id: "entry-1", start_at: "2026-11-27T18:00:00.000Z" }]);
    expect(await daysUntilNextMeeting(client, { leadId: LEAD, organizationId: ORG, entryId: "entry-1" }, NOW)).toBe(3);
  });
  it("sem reunião: undefined, que reprova qualquer comparação numérica", async () => {
    const { client } = fakeSupabase([]);
    expect(await daysUntilNextMeeting(client, { leadId: LEAD, organizationId: ORG, entryId: null }, NOW)).toBeUndefined();
  });
});

describe("meeting-variables — contrato com compare() do avaliador de condição", async () => {
  const { compare } = await import("../../supabase/functions/_shared/workflow-condition-evaluator");
  it("sem reunião (undefined) reprova 'menor que' e 'maior ou igual'", () => {
    expect(compare(undefined, "less_than", "3")).toBe(false);
    expect(compare(undefined, "greater_or_equal", "3")).toBe(false);
  });
  it("sem reunião casa com 'está vazio'", () => {
    expect(compare(undefined, "is_empty", "")).toBe(true);
  });
  it("reunião a 3 dias passa em 'maior ou igual a 3' (aquecimento do brief)", () => {
    expect(compare(3, "greater_or_equal", "3")).toBe(true);
    expect(compare(2, "greater_or_equal", "3")).toBe(false);
  });
});
