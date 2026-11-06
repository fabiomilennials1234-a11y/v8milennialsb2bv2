import { describe, expect, it } from "vitest";
import {
  cronograma,
  DURACAO_MAX_MS,
  mapearResumo,
  MINIMO_AUTOMACOES,
  MINIMO_MOVIMENTACAO,
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

  it("o fecho nunca estica: com poucas cenas ele fica nos mesmos 8,3 s, não parado por mais tempo", () => {
    const tudo = cronograma(TODAS).find((x) => x.id === "fecho")!;
    const poucas = cronograma(["impacto", "leads", "fecho"]).find((x) => x.id === "fecho")!;
    expect(poucas.fim - poucas.inicio).toBe(tudo.fim - tudo.inicio);
  });

  it("a abertura de uma org só com leads dura bem menos que a cheia (e mais que o fecho sozinho)", () => {
    const c = cronograma(["impacto", "leads", "fecho"]);
    const total = c[c.length - 1].fim;
    expect(total).toBeLessThan(25_000);
    expect(total).toBeGreaterThan(12_000);
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
  // Volume típico de uma org de verdade (medido em produção: mediana de 23 execuções de automação).
  const automacoesFortes = { ...automacoes, execucoes: 40 };
  const movimentacaoForte = { ...movimentacao, total: 60 };

  it("sem blocos do Torque: só o essencial, na ordem da história", () => {
    expect(planejarCenas(mapearResumo(entrega)!)).toEqual(["impacto", "leads", "vendas", "receita", "fecho"]);
  });

  it("com tudo e com volume: as três cenas do Torque entram antes do fecho", () => {
    const tudo = mapearResumo({
      ...entrega,
      automacoes: automacoesFortes,
      movimentacao: movimentacaoForte,
      ranking,
    })!;
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

  // O caso que a medição em produção revelou: 25 das 33 orgs com abertura tiveram lead e NENHUMA venda.
  it("org só com leads e zero venda: sem as cenas de vendas e de receita", () => {
    const semVenda = mapearResumo({
      ...entrega,
      vendas: 0,
      receita: 0,
      por_dia: { ...entrega.por_dia, vendas: [0, 0, 0, 0, 0, 0, 0], receita: [0, 0, 0, 0, 0, 0, 0] },
    })!;
    expect(planejarCenas(semVenda)).toEqual(["impacto", "leads", "fecho"]);
  });

  it("venda sem valor (muito comum: a maioria dos negócios não tem valor): mostra vendas, não uma receita de R$ 0", () => {
    const semValor = mapearResumo({ ...entrega, receita: 0, por_dia: { ...entrega.por_dia, receita: [0, 0, 0, 0, 0, 0, 0] } })!;
    expect(planejarCenas(semValor)).toEqual(["impacto", "leads", "vendas", "fecho"]);
  });

  it("org com venda e zero lead: sem a cena de leads", () => {
    const semLead = mapearResumo({ ...entrega, leads: 0, por_dia: { ...entrega.por_dia, leads: [0, 0, 0, 0, 0, 0, 0] } })!;
    expect(planejarCenas(semLead)).toEqual(["impacto", "vendas", "receita", "fecho"]);
  });

  it.each([
    ["automação", { automacoes: { ...automacoes, execucoes: MINIMO_AUTOMACOES - 1 } }, "automacoes"],
    ["movimentação", { movimentacao: { ...movimentacao, total: MINIMO_MOVIMENTACAO - 1 } }, "movimentacao"],
  ])("%s abaixo do mínimo não vira cena (1 execução não merece uma cena inteira)", (_nome, extra, cena) => {
    expect(planejarCenas(mapearResumo({ ...entrega, ...extra })!)).not.toContain(cena);
  });

  it.each([
    ["automação", { automacoes: { ...automacoes, execucoes: MINIMO_AUTOMACOES } }, "automacoes"],
    ["movimentação", { movimentacao: { ...movimentacao, total: MINIMO_MOVIMENTACAO } }, "movimentacao"],
  ])("%s exatamente no mínimo vira cena (o limite é inclusivo)", (_nome, extra, cena) => {
    expect(planejarCenas(mapearResumo({ ...entrega, ...extra })!)).toContain(cena);
  });

  it("o ranking, que já vem só com gente que vendeu, entra mesmo em org pequena", () => {
    expect(planejarCenas(mapearResumo({ ...entrega, ranking })!)).toContain("ranking");
  });

  it("todo plano começa no impacto e termina no fecho, qualquer que seja o dado", () => {
    const so_leads = mapearResumo({ ...entrega, vendas: 0, receita: 0 })!;
    for (const r of [so_leads, mapearResumo(entrega)!]) {
      const p = planejarCenas(r);
      expect(p[0]).toBe("impacto");
      expect(p[p.length - 1]).toBe("fecho");
    }
  });
});
