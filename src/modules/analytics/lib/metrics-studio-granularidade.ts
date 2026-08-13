/**
 * Granularidade da série temporal do Estúdio.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *
 * O motor bucketa o recorte `tempo` sempre por DIA — `to_char(…, 'YYYY-MM-DD')`
 * em cada uma das sete leaves. Com o período em "Trim.", a janela recebe ~90
 * pontos num gráfico de 400px: as marcas do eixo somem, a linha vira ruído e
 * ninguém lê tendência ali. O rótulo "Por dia" também descreve mal o que a
 * pessoa quer — ela quer *a série no tempo*, na granularidade que couber.
 *
 * POR QUE AGRUPAR NO CLIENTE, E NÃO NO MOTOR
 *
 * Mudar o bucket no servidor significaria reescrever as sete leaves e mais uma
 * migration sobre `_metric_leaf` — o caminho que já apagou roteamento duas
 * vezes neste épico. E seria pior: o motor perderia a série diária, que é a
 * fonte de qualquer agregação. Agregar dia→semana→mês é soma exata quando a
 * medida é aditiva, e é feito com a série completa em mãos.
 *
 * ⚠ MÉDIA NÃO SE SOMA. `tempo_medio_etapa` e `tempo_medio_resposta` são médias:
 * somar os dias produziria um número sem significado. Para elas a agregação usa
 * MÉDIA dos baldes — aproximação honesta (média de médias, sem os pesos), e por
 * isso o seletor de granularidade fica indisponível nessas medidas.
 */

import type { MetricSeriesPoint } from "@/modules/analytics/lib/tv-series";

export type Granularidade = "dia" | "semana" | "mes";

export const GRANULARIDADES: { key: Granularidade; label: string }[] = [
  { key: "dia", label: "Por dia" },
  { key: "semana", label: "Por semana" },
  { key: "mes", label: "Por mês" },
];

/**
 * Escolha automática pelo tamanho da janela. Os cortes saem do que cabe num
 * gráfico de painel sem virar borrão: até ~5 semanas dá para ler dia a dia;
 * até ~4 meses, semana; além disso, mês.
 */
export function granularidadeAutomatica(pontos: number): Granularidade {
  if (pontos <= 35) return "dia";
  if (pontos <= 120) return "semana";
  return "mes";
}

/** Segunda-feira da semana de `iso` (`YYYY-MM-DD`), como `YYYY-MM-DD`. */
function inicioDaSemana(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  // getDay(): 0=domingo. Recuar para segunda mantém a semana comercial, que é
  // como a operação fala ("essa semana").
  const recuo = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - recuo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function chaveDoBalde(iso: string, granularidade: Granularidade): string {
  if (granularidade === "dia") return iso;
  if (granularidade === "semana") return inicioDaSemana(iso);
  return `${iso.slice(0, 7)}-01`;
}

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function rotuloDoBalde(chave: string, granularidade: Granularidade): string {
  const [ano, mes, dia] = chave.split("-");
  if (granularidade === "dia") return `${dia}/${mes}`;
  if (granularidade === "semana") return `${dia}/${mes}`;
  return `${MESES_CURTOS[Number(mes) - 1]}/${ano.slice(2)}`;
}

/**
 * Agrupa a série diária do motor na granularidade pedida.
 *
 * `media` decide a aritmética: soma para contagem e dinheiro, média para
 * medidas que já são médias. A série de entrada precisa vir com `key` no
 * formato `YYYY-MM-DD` — é o que o motor devolve no recorte `tempo`.
 */
export function agruparSerie(
  series: MetricSeriesPoint[],
  granularidade: Granularidade,
  media = false,
): MetricSeriesPoint[] {
  if (granularidade === "dia" || series.length === 0) return series;

  const baldes = new Map<string, { soma: number; n: number }>();
  for (const ponto of series) {
    const iso = ponto.key ?? "";
    // Ponto sem data (o motor usa 'Sem valor' em alguns recortes) não pertence
    // a balde nenhum — passa direto em vez de virar um balde fantasma.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    const chave = chaveDoBalde(iso, granularidade);
    const atual = baldes.get(chave) ?? { soma: 0, n: 0 };
    atual.soma += ponto.value;
    atual.n += 1;
    baldes.set(chave, atual);
  }

  return [...baldes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chave, { soma, n }]) => ({
      key: chave,
      label: rotuloDoBalde(chave, granularidade),
      value: media ? soma / n : soma,
    }));
}

/** Medidas cuja série é MÉDIA — somar os baldes produziria número sem sentido. */
const MEDIDAS_DE_MEDIA = new Set(["tempo_medio_etapa", "tempo_resposta_equipe"]);

export function ehMedidaDeMedia(measureId: string | undefined): boolean {
  return measureId !== undefined && MEDIDAS_DE_MEDIA.has(measureId);
}
