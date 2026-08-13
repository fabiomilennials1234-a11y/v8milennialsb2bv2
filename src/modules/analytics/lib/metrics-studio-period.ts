/**
 * Tradução do período do Estúdio para o vocabulário do motor (SCRUM-310).
 *
 * O seletor da tela fala Hoje / Semana / Mês / Trimestre. O motor fala
 * `day | week | month | range` — não existe `today` nem `quarter`.
 *
 * REGRA QUE NÃO SE QUEBRA: o front não calcula fronteira de período. Quem
 * corta é `metric_period_bounds`, no servidor, na timezone da ORG, meia-aberto.
 * O que este arquivo produz é uma DATA DE REFERÊNCIA (`YYYY-MM-DD`) — o
 * servidor decide onde o dia começa e termina.
 *
 * Trimestre é a exceção declarada: o motor não tem o conceito, então vira
 * `range` com as datas de início e fim do trimestre civil. Continua sendo data
 * de calendário, não instante — o servidor aplica a timezone.
 *
 * G4 do grill: toda janela também pede o período ANTERIOR, para o comparativo.
 * Em vez de calcular a janela anterior, deslocamos a data de referência e
 * deixamos o servidor recortar de novo — mesma regra, sem duplicar a lógica de
 * fronteira no cliente.
 */

import type { MetricPeriod } from "@/modules/analytics/hooks/useMetricMeasure";

export type StudioPeriod = "today" | "week" | "month" | "quarter";

export const STUDIO_PERIODS: { key: StudioPeriod; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mês" },
  { key: "quarter", label: "Trim." },
];

/** O que os hooks precisam para chamar `fn_metric_measure`. */
export interface EnginePeriod {
  period: MetricPeriod;
  ref: string | null;
  start: string | null;
  end: string | null;
}

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Primeiro dia do trimestre civil que contém `d`. */
function inicioDoTrimestre(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}

/**
 * Subtrai meses preservando a intenção de "mês anterior" em fim de mês.
 * 31/03 menos 1 mês vira 28/02 (ou 29), não 03/03 — que é o que
 * `setMonth(-1)` faria sozinho.
 */
function menosMeses(d: Date, n: number): Date {
  const alvo = new Date(d.getFullYear(), d.getMonth() - n, 1);
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  return new Date(alvo.getFullYear(), alvo.getMonth(), Math.min(d.getDate(), ultimoDia));
}

/** Janela atual. `hoje` é injetável para o teste não depender do relógio. */
export function periodoAtual(studio: StudioPeriod, hoje = new Date()): EnginePeriod {
  switch (studio) {
    case "today":
      return { period: "day", ref: iso(hoje), start: null, end: null };
    case "week":
      return { period: "week", ref: iso(hoje), start: null, end: null };
    case "month":
      return { period: "month", ref: iso(hoje), start: null, end: null };
    case "quarter":
      return {
        period: "range",
        ref: null,
        start: iso(inicioDoTrimestre(hoje)),
        end: iso(hoje),
      };
  }
}

/**
 * Janela anterior equivalente, para o comparativo (G4).
 *
 * Para day/week/month basta recuar a referência — o servidor recorta o período
 * inteiro. Para o trimestre, recua o intervalo inteiro pelo mesmo número de
 * dias decorridos, para comparar "trimestre até aqui" com "trimestre anterior
 * até o mesmo ponto" — comparar 40 dias contra 90 diria que despencou.
 */
export function periodoAnterior(studio: StudioPeriod, hoje = new Date()): EnginePeriod {
  switch (studio) {
    case "today": {
      const ontem = new Date(hoje);
      ontem.setDate(ontem.getDate() - 1);
      return { period: "day", ref: iso(ontem), start: null, end: null };
    }
    case "week": {
      const semanaPassada = new Date(hoje);
      semanaPassada.setDate(semanaPassada.getDate() - 7);
      return { period: "week", ref: iso(semanaPassada), start: null, end: null };
    }
    case "month":
      return { period: "month", ref: iso(menosMeses(hoje, 1)), start: null, end: null };
    case "quarter": {
      const inicioAtual = inicioDoTrimestre(hoje);
      const decorridos = Math.round(
        (hoje.getTime() - inicioAtual.getTime()) / (24 * 60 * 60 * 1000),
      );
      const inicioAnterior = new Date(
        inicioAtual.getFullYear(),
        inicioAtual.getMonth() - 3,
        1,
      );
      const fimAnterior = new Date(inicioAnterior);
      fimAnterior.setDate(fimAnterior.getDate() + decorridos);
      return {
        period: "range",
        ref: null,
        start: iso(inicioAnterior),
        end: iso(fimAnterior),
      };
    }
  }
}

/**
 * Variação percentual entre atual e anterior.
 *
 * `null` quando a comparação seria mentira: sem base anterior, base zero
 * (qualquer coisa vira infinito), ou período atual sem dado.
 */
export function variacaoPct(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null) return null;
  if (anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}
