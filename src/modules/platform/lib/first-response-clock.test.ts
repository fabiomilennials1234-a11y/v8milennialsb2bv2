import { describe, it, expect } from "vitest";
import {
  FIRST_RESPONSE_TARGETS,
  addBusinessDays,
  firstResponseClock,
} from "./first-response-clock";

const at = (iso: string) => new Date(iso);
const HOUR = 60 * 60 * 1000;

/** Segunda-feira, 10:00 UTC. */
const SEG = "2026-07-06T10:00:00Z";

describe("FIRST_RESPONSE_TARGETS", () => {
  // A meta é POLÍTICA, não fato da linha. Gravá-la em cada chamado obrigaria a
  // reescrever o passado quando ela mudasse — ou a conviver com duas políticas.
  it("crítica 1h, alta 4h, média 1 dia útil, baixa 3 dias úteis", () => {
    expect(FIRST_RESPONSE_TARGETS.critica).toEqual({ hours: 1 });
    expect(FIRST_RESPONSE_TARGETS.alta).toEqual({ hours: 4 });
    expect(FIRST_RESPONSE_TARGETS.media).toEqual({ businessDays: 1 });
    expect(FIRST_RESPONSE_TARGETS.baixa).toEqual({ businessDays: 3 });
  });
});

describe("addBusinessDays", () => {
  it("um dia útil a partir de segunda cai na terça", () => {
    expect(addBusinessDays(at(SEG), 1).toISOString()).toBe("2026-07-07T10:00:00.000Z");
  });

  // Sexta + 1 dia útil = segunda. Um chamado aberto na sexta não vence no sábado.
  it("pula o fim de semana", () => {
    const sexta = at("2026-07-10T10:00:00Z");
    expect(addBusinessDays(sexta, 1).toISOString()).toBe("2026-07-13T10:00:00.000Z");
  });

  it("três dias úteis a partir de quinta caem na terça seguinte", () => {
    const quinta = at("2026-07-09T10:00:00Z");
    expect(addBusinessDays(quinta, 3).toISOString()).toBe("2026-07-14T10:00:00.000Z");
  });

  it("zero dias não move a data", () => {
    expect(addBusinessDays(at(SEG), 0).toISOString()).toBe(at(SEG).toISOString());
  });

  // Sábado + 1 dia útil = segunda: a contagem começa no próximo dia útil.
  it("um chamado aberto no sábado vence na segunda", () => {
    const sabado = at("2026-07-11T10:00:00Z");
    expect(addBusinessDays(sabado, 1).toISOString()).toBe("2026-07-13T10:00:00.000Z");
  });
});

describe("firstResponseClock", () => {
  const base = {
    severidade: "critica" as const,
    createdAt: at(SEG),
    firstResponseAt: null,
    awaitingCustomerMs: 0,
    awaitingSince: null,
  };

  it("sem severidade não há meta — o chamado ainda não foi triado", () => {
    const c = firstResponseClock({ ...base, severidade: null, now: at(SEG) });
    expect(c.deadline).toBeNull();
    expect(c.isOverdue).toBe(false);
  });

  it("dentro da meta", () => {
    const c = firstResponseClock({ ...base, now: new Date(at(SEG).getTime() + 30 * 60 * 1000) });
    expect(c.isOverdue).toBe(false);
    expect(c.deadline!.toISOString()).toBe("2026-07-06T11:00:00.000Z");
    expect(c.elapsedMs).toBe(30 * 60 * 1000);
  });

  it("estourando a meta", () => {
    const c = firstResponseClock({ ...base, now: new Date(at(SEG).getTime() + 2 * HOUR) });
    expect(c.isOverdue).toBe(true);
  });

  // Sem descontar a espera, um chamado em que o cliente sumiu por uma semana
  // apareceria como "staff demorou 7 dias". A métrica mente, o time perde a
  // confiança nela e para de olhar.
  it("desconta uma janela de espera já fechada", () => {
    const c = firstResponseClock({
      ...base,
      awaitingCustomerMs: 3 * HOUR,
      now: new Date(at(SEG).getTime() + 3.5 * HOUR),
    });
    expect(c.elapsedMs).toBe(0.5 * HOUR);
    expect(c.isOverdue).toBe(false);
    expect(c.deadline!.toISOString()).toBe("2026-07-06T14:00:00.000Z");
  });

  it("desconta também a janela de espera ainda aberta", () => {
    const now = new Date(at(SEG).getTime() + 3 * HOUR);
    const c = firstResponseClock({
      ...base,
      awaitingSince: new Date(at(SEG).getTime() + 0.5 * HOUR),
      now,
    });
    expect(c.elapsedMs).toBe(0.5 * HOUR);
    expect(c.isOverdue).toBe(false);
  });

  it("acumula janelas fechadas e a aberta", () => {
    const now = new Date(at(SEG).getTime() + 5 * HOUR);
    const c = firstResponseClock({
      ...base,
      awaitingCustomerMs: 2 * HOUR,
      awaitingSince: new Date(at(SEG).getTime() + 4 * HOUR),
      now,
    });
    // 5h decorridas − 2h fechadas − 1h aberta = 2h úteis
    expect(c.elapsedMs).toBe(2 * HOUR);
  });

  // Respondido, o relógio congela: o que vier depois não é demora do suporte.
  it("congela em first_response_at", () => {
    const respondeu = new Date(at(SEG).getTime() + 0.5 * HOUR);
    const c = firstResponseClock({
      ...base,
      firstResponseAt: respondeu,
      now: new Date(at(SEG).getTime() + 10 * HOUR),
    });
    expect(c.elapsedMs).toBe(0.5 * HOUR);
    expect(c.isOverdue).toBe(false);
    expect(c.responded).toBe(true);
  });

  it("respondido depois da meta continua atrasado, para sempre", () => {
    const respondeu = new Date(at(SEG).getTime() + 3 * HOUR);
    const c = firstResponseClock({
      ...base,
      firstResponseAt: respondeu,
      now: new Date(at(SEG).getTime() + 100 * HOUR),
    });
    expect(c.isOverdue).toBe(true);
    expect(c.elapsedMs).toBe(3 * HOUR);
  });

  it("uma janela de espera aberta não conta depois da resposta", () => {
    const respondeu = new Date(at(SEG).getTime() + 0.5 * HOUR);
    const c = firstResponseClock({
      ...base,
      firstResponseAt: respondeu,
      awaitingSince: new Date(at(SEG).getTime() + 5 * HOUR),
      now: new Date(at(SEG).getTime() + 10 * HOUR),
    });
    expect(c.elapsedMs).toBe(0.5 * HOUR);
  });

  it("a meta de média respeita dias úteis", () => {
    const sexta = at("2026-07-10T10:00:00Z");
    const c = firstResponseClock({
      ...base,
      severidade: "media",
      createdAt: sexta,
      now: sexta,
    });
    expect(c.deadline!.toISOString()).toBe("2026-07-13T10:00:00.000Z");
  });

  it("o tempo decorrido nunca é negativo", () => {
    const c = firstResponseClock({
      ...base,
      awaitingCustomerMs: 10 * HOUR,
      now: new Date(at(SEG).getTime() + 1 * HOUR),
    });
    expect(c.elapsedMs).toBe(0);
  });
});
