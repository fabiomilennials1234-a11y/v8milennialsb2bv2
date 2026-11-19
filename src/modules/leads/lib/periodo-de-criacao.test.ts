import { describe, expect, it } from "vitest";
import {
  calendarioDoPeriodo,
  periodoDosDias,
  presetsDePeriodo,
  rotuloDoPeriodo,
} from "./periodo-de-criacao";

const SP = "America/Sao_Paulo";

describe("periodoDosDias", () => {
  it("corta o início e o fim do dia no fuso da org, não no do browser", () => {
    const p = periodoDosDias(new Date(2026, 10, 1), new Date(2026, 10, 19), SP);
    // SP é UTC-3 (sem DST desde 2019): 00:00 local = 03:00Z; 23:59:59.999 = 02:59:59.999Z do dia seguinte.
    expect(p).toEqual({ from: "2026-11-01T03:00:00.000Z", to: "2026-11-20T02:59:59.999Z" });
  });

  it("um dia só quando o fim não foi escolhido", () => {
    const p = periodoDosDias(new Date(2026, 10, 5), undefined, SP);
    expect(p).toEqual({ from: "2026-11-05T03:00:00.000Z", to: "2026-11-06T02:59:59.999Z" });
  });

  it("aceita o intervalo escolhido de trás para frente", () => {
    const p = periodoDosDias(new Date(2026, 10, 19), new Date(2026, 10, 1), SP);
    expect(p.from).toBe("2026-11-01T03:00:00.000Z");
    expect(p.to).toBe("2026-11-20T02:59:59.999Z");
  });
});

describe("presetsDePeriodo", () => {
  // 19/11/2026 15:43 em SP
  const agora = new Date("2026-11-19T18:43:00.000Z");
  const por = (k: string) => presetsDePeriodo(agora, SP).find((p) => p.key === k)!.periodo;

  it("este mês vai do dia 1 até o fim de hoje", () => {
    expect(por("este-mes")).toEqual({ from: "2026-11-01T03:00:00.000Z", to: "2026-11-20T02:59:59.999Z" });
  });

  it("mês passado é o mês fechado anterior", () => {
    expect(por("mes-passado")).toEqual({ from: "2026-10-01T03:00:00.000Z", to: "2026-11-01T02:59:59.999Z" });
  });

  it("últimos 7 dias contam hoje", () => {
    expect(por("7-dias")).toEqual({ from: "2026-11-13T03:00:00.000Z", to: "2026-11-20T02:59:59.999Z" });
  });

  it("virada de ano: mês passado de janeiro é dezembro do ano anterior", () => {
    const jan = new Date("2027-01-10T15:00:00.000Z");
    const p = presetsDePeriodo(jan, SP).find((x) => x.key === "mes-passado")!.periodo;
    expect(p).toEqual({ from: "2026-12-01T03:00:00.000Z", to: "2027-01-01T02:59:59.999Z" });
  });

  it("perto da meia-noite usa o dia da org, não o UTC", () => {
    // 20/11 01:30Z = 19/11 22:30 em SP → "hoje" ainda é 19/11.
    const tarde = new Date("2026-11-20T01:30:00.000Z");
    const p = presetsDePeriodo(tarde, SP).find((x) => x.key === "hoje")!.periodo;
    expect(p).toEqual({ from: "2026-11-19T03:00:00.000Z", to: "2026-11-20T02:59:59.999Z" });
  });
});

describe("calendarioDoPeriodo", () => {
  it("devolve os dias-calendário da org para marcar no calendário", () => {
    const r = calendarioDoPeriodo("2026-11-01T03:00:00.000Z", "2026-11-20T02:59:59.999Z", SP);
    expect(r?.from?.getDate()).toBe(1);
    expect(r?.from?.getMonth()).toBe(10);
    expect(r?.to?.getDate()).toBe(19);
  });

  it("sem início, não há seleção", () => {
    expect(calendarioDoPeriodo(undefined, undefined, SP)).toBeUndefined();
  });
});

describe("rotuloDoPeriodo", () => {
  it("intervalo", () => {
    expect(rotuloDoPeriodo("2026-11-01T03:00:00.000Z", "2026-11-20T02:59:59.999Z", SP)).toBe("01/11/2026 — 19/11/2026");
  });
  it("um dia", () => {
    expect(rotuloDoPeriodo("2026-11-05T03:00:00.000Z", "2026-11-06T02:59:59.999Z", SP)).toBe("05/11/2026");
  });
  it("só início", () => {
    expect(rotuloDoPeriodo("2026-11-01T03:00:00.000Z", undefined, SP)).toBe("a partir de 01/11/2026");
  });
  it("só fim", () => {
    expect(rotuloDoPeriodo(undefined, "2026-11-20T02:59:59.999Z", SP)).toBe("até 19/11/2026");
  });
});
