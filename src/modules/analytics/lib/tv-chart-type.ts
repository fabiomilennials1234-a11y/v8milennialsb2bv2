/**
 * Escolha do tipo de gráfico de um widget (#1218 / #1253).
 *
 * O estilo visual é uma dimensão SEPARADA do catálogo de número (`value_format`/
 * `format_id` = currency/integer/…). A partir do #1253 ele é uma COLUNA
 * (`widget_style`) que o cliente escolhe — quando presente, VENCE; quando `null`,
 * DERIVA do recorte (o mecanismo de sempre). Explícito vence, derivação é o
 * default: os dois se compõem, não competem (Vitral §1.2).
 */

export type TvChartType =
  | "number"
  | "bar"
  | "line"
  | "donut"
  | "ranking"
  | "progress"
  | "funnel";

const STYLES: ReadonlySet<string> = new Set<TvChartType>([
  "number", "bar", "line", "donut", "ranking", "progress", "funnel",
]);

/** Recortes que são séries temporais → linha. */
const TEMPORAL = new Set(["tempo"]);

/** Recortes categóricos → barra por padrão (donut/ranking são escolha explícita). */
const CATEGORICAL = new Set(["closer", "sdr", "origem", "tag", "produto", "stream", "etapa", "pipeline"]);

/**
 * Derivação a partir do recorte (o default do #1218): total→number, tempo→line,
 * categórico→bar. É o que faz "adicionar widget e já vir bom" sem escolher nada.
 */
export function deriveStyle(recorteId?: string | null): TvChartType {
  if (!recorteId || recorteId === "total") return "number";
  if (TEMPORAL.has(recorteId)) return "line";
  if (CATEGORICAL.has(recorteId)) return "bar";
  return "number";
}

/**
 * Estilo efetivo do widget: `widget_style ?? deriveStyle(recorte)` (Vitral §1.2).
 * `explicit` (widget_style do #1253) sempre vence; qualquer valor fora dos 7
 * formatos cai na derivação (nunca erro — mesma doutrina da galeria: incompatível
 * é ausente, não exceção).
 */
export function resolveChartType(recorteId?: string | null, explicit?: string | null): TvChartType {
  if (explicit && STYLES.has(explicit)) return explicit as TvChartType;
  return deriveStyle(recorteId);
}
