/**
 * Formatação de valor de métrica — camada própria (spec §2.6b), não detalhe de renderer.
 *
 * O formato vem do catálogo (`format_id` do widget), não de heurística sobre o número.
 * Regra dura da spec §5.1/§5.2: ausência de dado é `—`, NUNCA `0`. Zero é um dado.
 */

export type MetricFormatId =
  | "currency_brl"
  | "integer"
  | "percent_1"
  | "duration_human"
  | "ratio_2";

/** Travessão de ausência. Um valor nulo nunca vira 0. */
export const EM_DASH = "—";

const nf = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat("pt-BR", opts);

/**
 * Moeda compacta para parede: a 3m, `R$ 1,3 mi` lê melhor que `R$ 1.312.840,55`.
 * Abaixo de 1.000 mantém o valor cheio — encurtar aí perde precisão sem ganhar leitura.
 */
function formatCurrencyForWall(value: number): string {
  // Widgets §2.6b: moeda compacta a partir de ≥10 mil, 1 decimal (`R$ 14,4 mil`).
  // Antes cortava em 1.000 com 0 decimais (`R$ 14 mil`) — divergência da regra
  // escrita que o Vitral apontou (fonte única de formatação tem que bater c/ spec).
  const abs = Math.abs(value);
  const oneDec = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  if (abs >= 1_000_000) return `R$ ${nf(oneDec).format(value / 1_000_000)} mi`;
  if (abs >= 10_000) return `R$ ${nf(oneDec).format(value / 1_000)} mil`;
  return nf({ style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
}

/**
 * Duração legível a partir de segundos. Dois degraus no máximo — `3d 4h`, não `3d 4h 12m 8s`.
 * A 3m, o terceiro degrau é ruído.
 */
function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/**
 * `empty_reason` do motor que significa AUSÊNCIA de dado (não um zero legítimo).
 * O motor devolve `value: 0` + `empty_reason: 'no_rows'` quando a base não teve
 * nenhuma linha — 0 aí é "não há dado", não "o dado é zero".
 */
export function isEmptyReason(reason?: string | null): boolean {
  return reason === "no_rows" || reason === "never_existed";
}

/**
 * Resolve o valor de cabeça respeitando `empty_reason` (spec §5.2 / AC #7).
 *
 * REGRA DURA: quando o motor sinaliza ausência (`no_rows`/`never_existed`), o
 * valor de cabeça é `—`, MESMO que o número venha 0. Um leaf de contagem sem
 * registros chega como `value: 0, empty_reason: 'no_rows'`, e mostrar "0" numa
 * parede é exibir ausência de dado como se fosse dado. Zero legítimo (base com
 * linhas somando zero) vem sem empty_reason e continua sendo 0.
 */
export function resolveHeadValue(
  value: number | null | undefined,
  emptyReason?: string | null,
): number | null {
  if (isEmptyReason(emptyReason)) return null;
  return value ?? null;
}

/**
 * Formata o valor de cabeça de um widget.
 * `null`/`undefined`/`NaN` → `—` (§5.2). Nunca devolve "0" para ausência.
 */
export function formatMetricValue(
  value: number | null | undefined,
  formatId?: string | null,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH;

  switch (formatId as MetricFormatId) {
    case "currency_brl":
      return formatCurrencyForWall(value);
    case "percent_1":
      return `${nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}%`;
    case "duration_human":
      return formatDuration(value);
    case "ratio_2":
      return nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    case "integer":
    default:
      return nf({ maximumFractionDigits: 0 }).format(value);
  }
}

/**
 * Escala tipográfica por peso (spec §1 "Densidade e peso").
 * O peso amarra tamanho de célula à escala — o widget declara peso, não estilo.
 */
export const WEIGHT_TYPE_SCALE: Record<string, string> = {
  hero: "var(--tv-hero)",
  primary: "var(--tv-value)",
  secondary: "var(--tv-value-sm)",
};

export function typeScaleForWeight(weight?: string | null): string {
  return WEIGHT_TYPE_SCALE[weight ?? "secondary"] ?? WEIGHT_TYPE_SCALE.secondary;
}

/**
 * Só conta como `hero` — para o teto de 8 widgets/página (§6.4) — o widget que usa
 * `--tv-hero`. O gatilho do teto é a TIPOGRAFIA, não o tamanho da célula: um bloco
 * grande em células com tipo `--tv-value` (caso do Thermometer 3×4) NÃO dispara o teto.
 */
export function usesHeroTypography(weight?: string | null): boolean {
  return weight === "hero";
}
