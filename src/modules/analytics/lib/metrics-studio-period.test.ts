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
    // `custom` é o único que exige argumento — sem intervalo ele levanta erro
    // DE PROPÓSITO (ver "custom SEM intervalo levanta erro"). Dar o intervalo
    // aqui mantém a varredura provando o que ela existe para provar: que todo
    // item do seletor tem tradução, e nenhum ficou órfão.
    const rangeQuandoPreciso = { from: "2026-08-01", to: "2026-08-10" };
    for (const { key } of STUDIO_PERIODS) {
      expect(() => periodoAtual(key, HOJE, rangeQuandoPreciso)).not.toThrow();
      expect(() => periodoAnterior(key, HOJE, rangeQuandoPreciso)).not.toThrow();
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

describe("período personalizado (SCRUM-313)", () => {
  const RANGE = { from: "2026-08-01", to: "2026-08-10" };

  it("entra como range, com as datas CRUAS do usuário", () => {
    expect(periodoAtual("custom", HOJE, RANGE)).toEqual({
      period: "range",
      ref: null,
      start: "2026-08-01",
      end: "2026-08-10",
    });
  });

  it("o anterior são os mesmos N dias encostados antes, sem sobrepor", () => {
    // 10 dias (01 a 10 de agosto) → 22 a 31 de julho. Comparar com julho
    // inteiro diria que despencou.
    expect(periodoAnterior("custom", HOJE, RANGE)).toEqual({
      period: "range",
      ref: null,
      start: "2026-07-22",
      end: "2026-07-31",
    });
  });

  it("intervalo de um dia só compara com o dia anterior", () => {
    const umDia = { from: "2026-08-05", to: "2026-08-05" };
    expect(periodoAnterior("custom", HOJE, umDia)).toEqual({
      period: "range",
      ref: null,
      start: "2026-08-04",
      end: "2026-08-04",
    });
  });

  it("atravessa a virada do ano sem se perder", () => {
    const rev = { from: "2027-01-01", to: "2027-01-05" };
    expect(periodoAnterior("custom", HOJE, rev)).toEqual({
      period: "range",
      ref: null,
      start: "2026-12-27",
      end: "2026-12-31",
    });
  });

  it("custom SEM intervalo levanta erro — não cai para mês em silêncio", () => {
    expect(() => periodoAtual("custom", HOJE)).toThrow(/sem intervalo/);
    expect(() => periodoAtual("custom", HOJE, null)).toThrow(/sem intervalo/);
    expect(() => periodoAtual("custom", HOJE, { from: "2026-08-01", to: "" })).toThrow(
      /sem intervalo/,
    );
    expect(() => periodoAnterior("custom", HOJE)).toThrow(/sem intervalo/);
  });

  it("está no seletor da tela", () => {
    const chaves: StudioPeriod[] = STUDIO_PERIODS.map((p) => p.key);
    expect(chaves).toContain("custom");
  });
});

describe("FRONTEIRA DE DIA — o front não corta, o servidor corta", () => {
  // O cartão SCRUM-313 marca este bloco como obrigatório, e a razão tem nome:
  // o "Hoje" do dashboard já contou por dia-UTC enquanto a lista mostrava BRT,
  // e deu 6 contra 1 na virada do dia. A defesa aqui é NÃO calcular fronteira.

  it("nenhum preset devolve instante — só data de calendário YYYY-MM-DD", () => {
    const AAAA_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
    const casos: [StudioPeriod, { from: string; to: string } | undefined][] = [
      ["today", undefined],
      ["week", undefined],
      ["month", undefined],
      ["quarter", undefined],
      ["custom", { from: "2026-08-01", to: "2026-08-10" }],
    ];
    for (const [p, r] of casos) {
      for (const janela of [periodoAtual(p, HOJE, r), periodoAnterior(p, HOJE, r)]) {
        for (const v of [janela.ref, janela.start, janela.end]) {
          if (v !== null) expect(v).toMatch(AAAA_MM_DD);
        }
      }
    }
  });

  it("o range do usuário chega ao motor sem nenhum ajuste de fuso", () => {
    // Se alguém introduzir startOfUTCDay aqui (como faz useCommandMetrics), o
    // 01/08 de uma org em BRT vira 31/07 e este teste cai.
    const r = { from: "2026-08-01", to: "2026-08-31" };
    const janela = periodoAtual("custom", HOJE, r);
    expect(janela.start).toBe("2026-08-01");
    expect(janela.end).toBe("2026-08-31");
  });

  it("hoje perto da meia-noite local não muda a data de referência", () => {
    const quaseMeiaNoite = new Date(2026, 7, 12, 23, 59, 59);
    const logoDepois = new Date(2026, 7, 12, 0, 0, 1);
    expect(periodoAtual("today", quaseMeiaNoite).ref).toBe("2026-08-12");
    expect(periodoAtual("today", logoDepois).ref).toBe("2026-08-12");
  });
});
