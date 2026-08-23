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

export type StudioPeriod = "today" | "week" | "month" | "quarter" | "custom";

export const STUDIO_PERIODS: { key: StudioPeriod; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mês" },
  { key: "quarter", label: "Trim." },
  { key: "custom", label: "Escolher" },
];

/**
 * Intervalo escolhido pelo usuário (SCRUM-313).
 *
 * São DATAS DE CALENDÁRIO em `YYYY-MM-DD`, não instantes — mesma disciplina do
 * resto do arquivo. O componente de seleção trabalha com `Date`; converta na
 * borda com `isoDaData`, e nunca passe um instante adiante.
 *
 * 🔴 POR QUE NÃO COPIAMOS O COMANDO. `useCommandMetrics` monta o intervalo com
 * `startOfUTCDay`/`endOfUTCDay` — fronteira calculada NO CLIENTE, em UTC. Para
 * uma org em BRT isso desloca a virada do dia em 3 horas, que é exatamente o
 * defeito já observado no "Hoje" do dashboard (contava por dia-UTC enquanto a
 * lista mostrava BRT). Aqui as datas viajam cruas e `metric_period_bounds`
 * recorta no servidor, na timezone da ORG. As duas telas devem parecer iguais
 * ao usuário — não devem calcular igual.
 */
export interface StudioRange {
  from: string;
  to: string;
}

/** `Date` do seletor → data de calendário, sem passar por instante. */
export const isoDaData = (d: Date): string => iso(d);

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

/**
 * Falha ALTA quando `custom` chega sem intervalo.
 *
 * Cair para "mês" seria pior que o erro: a janela mostraria um número plausível
 * de um período que o usuário não pediu, e nada denunciaria. Quem chama garante
 * o intervalo antes — a página só oferece `custom` com as duas pontas escolhidas.
 */
function exigeRange(range: StudioRange | null | undefined): StudioRange {
  if (!range?.from || !range?.to) {
    throw new Error(
      "período personalizado sem intervalo: escolha as duas datas antes de medir",
    );
  }
  return range;
}

/** Dias inteiros entre duas datas de calendário, inclusivo nas duas pontas. */
function diasNoIntervalo(de: string, ate: string): number {
  const a = new Date(`${de}T00:00:00`);
  const b = new Date(`${ate}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

/** Janela atual. `hoje` é injetável para o teste não depender do relógio. */
export function periodoAtual(
  studio: StudioPeriod,
  hoje = new Date(),
  range?: StudioRange | null,
): EnginePeriod {
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
    case "custom": {
      const r = exigeRange(range);
      // As datas seguem CRUAS. Nenhum `startOf`/`endOf` aqui — ver o comentário
      // de `StudioRange` sobre por que o Comando não serve de modelo neste ponto.
      return { period: "range", ref: null, start: r.from, end: r.to };
    }
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
export function periodoAnterior(
  studio: StudioPeriod,
  hoje = new Date(),
  range?: StudioRange | null,
): EnginePeriod {
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
    case "custom": {
      const r = exigeRange(range);
      const dias = diasNoIntervalo(r.from, r.to);
      // O anterior equivalente são os MESMOS N dias imediatamente antes do
      // início — encostado, sem sobrepor. Um intervalo de 1 a 10 de agosto
      // compara com 22 a 31 de julho, não com julho inteiro: comparar 10 dias
      // contra 31 diria que despencou.
      const inicio = new Date(`${r.from}T00:00:00`);
      const fimAnterior = new Date(inicio);
      fimAnterior.setDate(fimAnterior.getDate() - 1);
      const inicioAnterior = new Date(fimAnterior);
      inicioAnterior.setDate(inicioAnterior.getDate() - (dias - 1));
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
