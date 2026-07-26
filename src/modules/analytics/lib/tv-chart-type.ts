/**
 * Escolha do tipo de gráfico de um widget (#1218).
 *
 * O tipo de gráfico (número/barra/linha/donut/…) é uma dimensão SEPARADA do
 * catálogo — `format_id` no schema é FORMATO DE NÚMERO (currency/integer/…),
 * não tipo de gráfico. A escolha do tipo é da composição (spec §9: a frase
 * "[Receita] por [closer] em [barra]") e vai viver no Composer.
 *
 * v1 (sem coluna no banco): DERIVA do recorte, que é o sinal disponível. É
 * acréscimo, não retrabalho — quando o Composer trouxer uma coluna `chart_type`,
 * ela entra aqui como override e a derivação vira o default.
 */

export type TvChartType = "number" | "bar" | "line" | "donut";

/** Recortes que são séries temporais → linha. */
const TEMPORAL = new Set(["tempo"]);

/** Recortes categóricos → barra por padrão (donut é escolha explícita do Composer). */
const CATEGORICAL = new Set(["closer", "sdr", "origem", "tag", "produto", "stream", "etapa", "pipeline"]);

/**
 * Deriva o tipo de gráfico a partir do recorte.
 *   total       → number (só o valor de cabeça, sem corpo)
 *   tempo       → line
 *   categórico  → bar
 *
 * `explicit` (futuro, do Composer) sempre vence — barra vs donut para o mesmo
 * recorte categórico é escolha do cliente (§3.3), não derivável.
 */
export function resolveChartType(recorteId?: string | null, explicit?: string | null): TvChartType {
  if (explicit === "bar" || explicit === "line" || explicit === "donut" || explicit === "number") {
    return explicit;
  }
  if (!recorteId || recorteId === "total") return "number";
  if (TEMPORAL.has(recorteId)) return "line";
  if (CATEGORICAL.has(recorteId)) return "bar";
  return "number";
}
