import { describe, it, expect } from "vitest";
import {
  periodoAnterior,
  periodoAtual,
  variacaoPct,
  STUDIO_PERIODS,
  type StudioPeriod,
} from "./metrics-studio-period";

// Quarta-feira, 2026-08-12. Meio de mês e meio de trimestre — evita que o
// teste passe por acidente de borda.
const HOJE = new Date(2026, 7, 12);

describe("período atual", () => {
  it("traduz para o vocabulário do motor, que não tem today nem quarter", () => {
    expect(periodoAtual("today", HOJE).period).toBe("day");
    expect(periodoAtual("week", HOJE).period).toBe("week");
    expect(periodoAtual("month", HOJE).period).toBe("month");
    expect(periodoAtual("quarter", HOJE).period).toBe("range");
  });

  it("day/week/month mandam só a referência — quem recorta é o servidor", () => {
    for (const p of ["today", "week", "month"] as StudioPeriod[]) {
      const r = periodoAtual(p, HOJE);
      expect(r.ref).toBe("2026-08-12");
      expect(r.start).toBeNull();
      expect(r.end).toBeNull();
    }
  });

  it("trimestre vira range do 1º dia do trimestre civil até hoje", () => {
    const r = periodoAtual("quarter", HOJE);
    expect(r.start).toBe("2026-07-01");
    expect(r.end).toBe("2026-08-12");
    expect(r.ref).toBeNull();
  });

  it("o trimestre é civil, não móvel", () => {
    expect(periodoAtual("quarter", new Date(2026, 0, 15)).start).toBe("2026-01-01");
    expect(periodoAtual("quarter", new Date(2026, 3, 1)).start).toBe("2026-04-01");
    expect(periodoAtual("quarter", new Date(2026, 11, 31)).start).toBe("2026-10-01");
  });

  it("a data sai em ISO, que é o que o Postgres espera como date", () => {
    expect(periodoAtual("month", new Date(2026, 0, 5)).ref).toBe("2026-01-05");
  });
});

describe("período anterior — o comparativo do G4", () => {
  it("hoje compara com ontem", () => {
    expect(periodoAnterior("today", HOJE).ref).toBe("2026-08-11");
  });

  it("semana compara com sete dias atrás", () => {
    expect(periodoAnterior("week", HOJE).ref).toBe("2026-08-05");
  });

  it("mês compara com o mês anterior", () => {
    expect(periodoAnterior("month", HOJE).ref).toBe("2026-07-12");
  });

  it("vira o ano sem quebrar", () => {
    expect(periodoAnterior("month", new Date(2026, 0, 10)).ref).toBe("2025-12-10");
    expect(periodoAnterior("today", new Date(2026, 0, 1)).ref).toBe("2025-12-31");
  });

  it("fim de mês não escorrega para o mês seguinte", () => {
    // 31/03 menos 1 mês é 28/02 — setMonth(-1) daria 03/03.
    expect(periodoAnterior("month", new Date(2026, 2, 31)).ref).toBe("2026-02-28");
    // 2028 é bissexto.
    expect(periodoAnterior("month", new Date(2028, 2, 31)).ref).toBe("2028-02-29");
  });

  it("trimestre compara o mesmo número de dias decorridos, não o trimestre cheio", () => {
    // 42 dias decorridos desde 01/07. O anterior vai de 01/04 a 12/05.
    const r = periodoAnterior("quarter", HOJE);
    expect(r.start).toBe("2026-04-01");
    expect(r.end).toBe("2026-05-13");
  });

  it("trimestre atravessa a virada de ano", () => {
    const r = periodoAnterior("quarter", new Date(2026, 0, 20));
    expect(r.start).toBe("2025-10-01");
  });

  it("todo período do seletor tem tradução nos dois sentidos", () => {
    for (const { key } of STUDIO_PERIODS) {
      expect(() => periodoAtual(key, HOJE)).not.toThrow();
      expect(() => periodoAnterior(key, HOJE)).not.toThrow();
    }
  });
});

describe("variação percentual", () => {
  it("calcula subida e queda", () => {
    expect(variacaoPct(120, 100)).toBe(20);
    expect(variacaoPct(80, 100)).toBeCloseTo(-20);
  });

  it("cala a boca quando comparar seria mentira", () => {
    expect(variacaoPct(100, 0)).toBeNull(); // dividir por zero vira infinito
    expect(variacaoPct(null, 100)).toBeNull(); // período atual sem dado
    expect(variacaoPct(100, null)).toBeNull(); // sem base de comparação
    expect(variacaoPct(null, null)).toBeNull();
  });

  it("zero contra zero é null, não 0% — não houve nada para comparar", () => {
    expect(variacaoPct(0, 0)).toBeNull();
  });

  it("base negativa usa módulo, para o sinal não inverter", () => {
    expect(variacaoPct(-50, -100)).toBe(50);
  });
});
