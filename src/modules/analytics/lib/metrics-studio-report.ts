/**
 * Relatório do painel do Estúdio (SCRUM-312 · G10 do grill).
 *
 * G10 decidiu PLANILHA, não PDF: o ICP (fábrica, distribuidora) cruza número
 * de CRM com número de ERP, e o repo já tem caminho provado de XLSX
 * (`exceljs`, usado por `useExportLeads`). PDF virou ticket próprio.
 *
 * Este arquivo é só a MONTAGEM — puro, sem I/O e sem exceljs. Recebe as
 * medidas já buscadas e devolve a estrutura de abas. Assim o formato do
 * relatório é testável sem browser e sem banco.
 */

import type { MetricMeasureResult } from "@/modules/analytics/hooks/useMetricMeasure";
import { ROTULO_DO_CORTE, type EngineMetric, type MetricRecorte } from "./metrics-studio-engine-map";
import { formatMetricValue } from "./tv-metric-format";
import { headValueFromMeasure } from "./tv-series";
import { variacaoPct } from "./metrics-studio-period";

export type ReportScope = "month" | "quarter";

export const REPORT_SCOPE_LABEL: Record<ReportScope, string> = {
  month: "Mensal",
  quarter: "Trimestral",
};

export interface ReportItem {
  metric: EngineMetric;
  corte: MetricRecorte;
  atual: MetricMeasureResult | null;
  anterior: MetricMeasureResult | null;
}

export interface ReportCell {
  /** `text` mantém a formatação humana; `num` alimenta fórmula na planilha. */
  text: string;
  num?: number | null;
}

export interface ReportSheet {
  nome: string;
  linhas: (string | number | null)[][];
}

export interface ReportInput {
  orgNome: string;
  scope: ReportScope;
  periodoLabel: string;
  geradoEm: Date;
  itens: ReportItem[];
}

/**
 * Neutraliza injeção de fórmula.
 *
 * Célula que começa com `=`, `+`, `-` ou `@` é interpretada como fórmula pelo
 * Excel e pelo Sheets. Os rótulos deste relatório vêm de campo livre do
 * cliente — nome de origem, de tag, de etapa, de vendedor. É a mesma falha que
 * `useExportLeads` tem hoje (escapa vírgula e aspas, não fórmula) e que não
 * vamos herdar por cópia.
 */
export function sanitizarCelula(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
}

/** Nome de aba do Excel: máx 31 chars e sem : \ / ? * [ ] */
export function nomeDeAba(bruto: string, usados: Set<string>): string {
  const limpo = bruto.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Aba";
  if (!usados.has(limpo)) {
    usados.add(limpo);
    return limpo;
  }
  // Colisão: sufixo numérico, ainda respeitando os 31 chars.
  for (let i = 2; i < 100; i++) {
    const alt = `${limpo.slice(0, 31 - String(i).length - 1)} ${i}`;
    if (!usados.has(alt)) {
      usados.add(alt);
      return alt;
    }
  }
  usados.add(limpo);
  return limpo;
}

/**
 * Monta as abas do relatório.
 *
 * Aba 1 "Resumo": uma linha por janela do painel, com valor, período anterior
 * e variação. É o que se olha primeiro.
 *
 * Abas seguintes: uma por janela que tenha quebra (por origem, vendedor,
 * etapa…), com o detalhe. Janela de número puro não gera aba própria — seria
 * uma aba de uma célula.
 */
export function montarRelatorio(input: ReportInput): ReportSheet[] {
  const { orgNome, scope, periodoLabel, geradoEm, itens } = input;

  const cabecalho: (string | number | null)[][] = [
    ["Relatório de Métricas", null],
    ["Organização", sanitizarCelula(orgNome)],
    ["Período", `${REPORT_SCOPE_LABEL[scope]} — ${periodoLabel}`],
    ["Gerado em", geradoEm.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })],
    [null, null],
  ];

  const resumo: ReportSheet = {
    nome: "Resumo",
    linhas: [
      ...cabecalho,
      ["Métrica", "Corte", "Valor", "Período anterior", "Variação", "Observação"],
    ],
  };

  const detalhes: ReportSheet[] = [];
  const nomesUsados = new Set<string>(["Resumo"]);

  for (const item of itens) {
    const { metric, corte, atual, anterior } = item;

    const valor = headValueFromMeasure(atual);
    const valorAnterior = headValueFromMeasure(anterior);
    const variacao = variacaoPct(valor, valorAnterior);

    // O motor degrada o corte em silêncio e reporta o efetivo. O relatório tem
    // que dizer o que o número REALMENTE é, ou vira documento errado impresso.
    const corteEfetivo = (atual?.recorte as MetricRecorte | undefined) ?? corte;
    const observacao =
      atual === null
        ? "Sem dado disponível"
        : corteEfetivo !== corte
          ? `Corte pedido (${ROTULO_DO_CORTE[corte]}) indisponível; número é do total`
          : "";

    resumo.linhas.push([
      sanitizarCelula(metric.label),
      ROTULO_DO_CORTE[corteEfetivo],
      valor === null ? "—" : formatMetricValue(valor, metric.formatId),
      valorAnterior === null ? "—" : formatMetricValue(valorAnterior, metric.formatId),
      variacao === null ? "—" : `${variacao > 0 ? "+" : ""}${variacao.toFixed(1)}%`,
      observacao,
    ]);

    const serie = atual?.series;
    if (Array.isArray(serie) && serie.length > 0) {
      const total = serie.reduce((acc, p) => acc + (p.value ?? 0), 0);
      detalhes.push({
        nome: nomeDeAba(`${metric.label} — ${ROTULO_DO_CORTE[corteEfetivo]}`, nomesUsados),
        linhas: [
          [sanitizarCelula(metric.label), ROTULO_DO_CORTE[corteEfetivo]],
          ["Período", `${REPORT_SCOPE_LABEL[scope]} — ${periodoLabel}`],
          [null, null],
          [ROTULO_DO_CORTE[corteEfetivo], "Valor", "Participação"],
          ...serie.map((p) => [
            sanitizarCelula(p.label),
            // Número CRU aqui de propósito: é a coluna que o cliente vai
            // somar e cruzar no ERP dele. O formatado fica no Resumo.
            p.value,
            total > 0 ? `${((p.value / total) * 100).toFixed(1)}%` : "—",
          ]),
          [null, null],
          ["Total", total, "100,0%"],
        ],
      });
    }
  }

  if (itens.length === 0) {
    resumo.linhas.push(["Painel vazio", "", "", "", "", "Adicione métricas antes de exportar"]);
  }

  return [resumo, ...detalhes];
}

/** Nome do arquivo, no padrão de slug do repo. */
export function nomeDoArquivo(orgNome: string, scope: ReportScope, quando: Date): string {
  const slug = orgNome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "org";
  const data = `${quando.getFullYear()}-${String(quando.getMonth() + 1).padStart(2, "0")}-${String(quando.getDate()).padStart(2, "0")}`;
  return `metricas_${slug}_${scope === "month" ? "mensal" : "trimestral"}_${data}.xlsx`;
}
