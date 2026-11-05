import { describe, expect, it } from "vitest";
import {
  cronograma,
  DURACAO_MAX_MS,
  mapearResumo,
  nomeDoMes,
  planejarCenas,
  SOBREPOSICAO_MS,
  type CenaId,
} from "./boas-vindas-semana";

/** O essencial que `boas_vindas_semana_reivindicar` sempre devolve quando entrega. */
const entrega = {
  elegivel: true,
  inicio: "2027-10-25",
  fim: "2027-10-31",
  leads: 5,
  vendas: 3,
  receita: 1800,
  por_dia: {
    leads: [2, 0, 1, 1, 0, 0, 1],
    vendas: [0, 1, 0, 1, 0, 0, 1],
    receita: [0, 1000, 0, 500, 0, 0, 300],
  },
};

const automacoes = { execucoes: 6, anterior: 3, top: { nome: "Boas-vindas", execucoes: 4 } };
const movimentacao = { total: 5, top: { nome: "Ana", movimentos: 3, voce: false } };
const ranking = {
  mes: 10,
  ano: 2027,
  corrente: false,
  pessoas: 2,
  top: [
    { nome: "Ana", valor: 8000, vendas: 2, posicao: 1, voce: false },
    { nome: "Membro A", valor: 4000, vendas: 1, posicao: 2, voce: true },
  ],
  voce: { posicao: 2, valor: 4000, vendas: 1 },
};

describe("blocos do Torque (opcionais)", () => {
  it("entram quando válidos", () => {
    const r = mapearResumo({ ...entrega, automacoes, movimentacao, ranking });
    expect(r?.automacoes).toEqual(automacoes);
    expect(r?.movimentacao).toEqual(movimentacao);
    expect(r?.ranking?.top.map((t) => t.nome)).toEqual(["Ana", "Membro A"]);
    expect(r?.ranking?.voce).toEqual({ posicao: 2, valor: 4000, vendas: 1 });
  });

  it("ausentes: a abertura segue só com o essencial", () => {
    const r = mapearResumo(entrega);
    expect(r).not.toBeNull();
    expect(r?.automacoes).toBeUndefined();
    expect(r?.movimentacao).toBeUndefined();
    expect(r?.ranking).toBeUndefined();
  });

  it("um bloco malformado some SOZINHO — não leva a abertura junto", () => {
    const r = mapearResumo({
      ...entrega,
      automacoes: { execucoes: "muitas" },
      movimentacao,
      ranking: { ...ranking, mes: 13 },
    });
    expect(r).not.toBeNull();
    expect(r?.leads).toBe(5);
    expect(r?.automacoes).toBeUndefined();
    expect(r?.ranking).toBeUndefined();
    expect(r?.movimentacao).toEqual(movimentacao);
  });

  it.each([
    ["automação com zero execuções", { automacoes: { ...automacoes, execucoes: 0 } }, "automacoes"],
    ["movimentação sem nome", { movimentacao: { total: 3, top: { nome: "  ", movimentos: 3 } } }, "movimentacao"],
    ["ranking sem ninguém", { ranking: { ...ranking, top: [] } }, "ranking"],
    ["ranking só com linhas inválidas", { ranking: { ...ranking, top: [{ nome: "X" }] } }, "ranking"],
  ])("%s não vira cena", (_nome, extra, bloco) => {
    const r = mapearResumo({ ...entrega, ...extra }) as unknown as Record<string, unknown>;
    expect(r[bloco]).toBeUndefined();
  });

  it("automação sem top (workflow apagado) ainda conta as execuções", () => {
    const r = mapearResumo({ ...entrega, automacoes: { execucoes: 6, anterior: 3, top: null } });
    expect(r?.automacoes).toEqual({ execucoes: 6, anterior: 3, top: null });
  });

  it("ranking entra ordenado por posição, mesmo que o banco mande desordenado", () => {
    const desordenado = { ...ranking, top: [...ranking.top].reverse() };
    expect(mapearResumo({ ...entrega, ranking: desordenado })?.ranking?.top.map((t) => t.posicao)).toEqual([1, 2]);
  });

  it("quem não é vendedor não tem posição, e ainda vê o ranking", () => {
    const r = mapearResumo({ ...entrega, ranking: { ...ranking, voce: null } });
    expect(r?.ranking?.voce).toBeNull();
  });
});

describe("nomeDoMes", () => {
  it("em português, por extenso", () => {
    expect(nomeDoMes(10, 2027)).toBe("outubro");
    expect(nomeDoMes(3, 2027)).toBe("março");
  });
});

describe("cronograma", () => {
  const TODAS: CenaId[] = ["impacto", "leads", "vendas", "receita", "automacoes", "movimentacao", "ranking", "fecho"];

  it("com todas as cenas, fecha EXATAMENTE no teto (42 s)", () => {
    const c = cronograma(TODAS);
    expect(c[0].inicio).toBe(0);
    expect(c[c.length - 1].fim).toBe(DURACAO_MAX_MS);
  });

  it("cada cena começa antes de a anterior terminar (é aí que mora a passagem)", () => {
    const c = cronograma(TODAS);
    for (let i = 1; i < c.length; i++) {
      expect(c[i - 1].fim - c[i].inicio).toBe(SOBREPOSICAO_MS);
    }
  });

  it("o fecho (o painel-resumo) é a cena mais longa: é o quadro que precisa ser lido", () => {
    const c = cronograma(TODAS);
    const duracoes = c.map((x) => ({ id: x.id, d: x.fim - x.inicio }));
    const maior = duracoes.reduce((a, b) => (b.d > a.d ? b : a));
    expect(maior.id).toBe("fecho");
    // E fica inteira na tela por tempo suficiente: pelo menos 8 s.
    expect(maior.d).toBeGreaterThanOrEqual(8_000);
  });

  it("nenhuma cena fica menor do que a coreografia dela pede (nada é espremido)", () => {
    const base = Object.fromEntries(cronograma(TODAS).map((x) => [x.id, x.fim - x.inicio]));
    const combinacoes: CenaId[][] = [
      ["impacto", "leads", "vendas", "receita", "fecho"],
      ["impacto", "leads", "vendas", "receita", "ranking", "fecho"],
    ];
    for (const cenas of combinacoes) {
      for (const x of cronograma(cenas)) expect(x.fim - x.inicio).toBeGreaterThanOrEqual(base[x.id]);
    }
  });

  it("com poucas cenas, estica no máximo 1,25× — e dura menos que o teto em vez de ficar parada", () => {
    const poucas: CenaId[] = ["impacto", "leads", "vendas", "receita", "fecho"];
    const c = cronograma(poucas);
    expect(c[c.length - 1].fim).toBeLessThan(DURACAO_MAX_MS);
    const base = cronograma(TODAS);
    const leads = c.find((x) => x.id === "leads")!;
    const leadsBase = base.find((x) => x.id === "leads")!;
    expect((leads.fim - leads.inicio) / (leadsBase.fim - leadsBase.inicio)).toBeLessThanOrEqual(1.25 + 1e-9);
  });

  it("nunca passa do teto, qualquer que seja a combinação de blocos", () => {
    const opcionais: CenaId[] = ["automacoes", "movimentacao", "ranking"];
    for (let mascara = 0; mascara < 8; mascara++) {
      const cenas: CenaId[] = [
        "impacto",
        "leads",
        "vendas",
        "receita",
        ...opcionais.filter((_, i) => mascara & (1 << i)),
        "fecho",
      ];
      const c = cronograma(cenas);
      expect(c[c.length - 1].fim).toBeLessThanOrEqual(DURACAO_MAX_MS);
    }
  });
});

describe("planejarCenas", () => {
  it("sem blocos do Torque: só o essencial, na ordem da história", () => {
    expect(planejarCenas(mapearResumo(entrega)!)).toEqual(["impacto", "leads", "vendas", "receita", "fecho"]);
  });

  it("com tudo: as três cenas do Torque entram antes do fecho", () => {
    const tudo = mapearResumo({ ...entrega, automacoes, movimentacao, ranking })!;
    expect(planejarCenas(tudo)).toEqual([
      "impacto",
      "leads",
      "vendas",
      "receita",
      "automacoes",
      "movimentacao",
      "ranking",
      "fecho",
    ]);
  });
});
