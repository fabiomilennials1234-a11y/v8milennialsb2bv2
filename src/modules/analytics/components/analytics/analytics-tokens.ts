/**
 * Analytics Design Tokens
 * Escala tipográfica e cores semânticas unificadas para toda a seção Analytics.
 * Importar AT e ACCENT em todos os componentes analytics — nenhum desvio permitido.
 */

export const AT = {
  // V5: rótulo micro, título de cartão 15px bold, número herói apertado.
  // Os `/50`–`/60` de opacidade no cinza reprovavam contraste no claro.
  metricLabel: "text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground",
  metricSublabel: "text-[11px] text-muted-foreground",
  chartTitle: "text-[15px] font-bold tracking-[-0.02em]",
  chartSubtitle: "text-xs text-muted-foreground",
  valueLg: "text-3xl font-extrabold tracking-[-0.04em] tabular-nums",
  valueMd: "text-xl font-extrabold tracking-[-0.03em] tabular-nums",
  valueSm: "text-sm font-semibold tabular-nums",
  sectionHeading: "text-lg font-bold tracking-[-0.03em]",
  sectionDesc: "text-sm text-muted-foreground",
} as const;

export type AccentColor = "emerald" | "blue" | "amber" | "destructive";

// As chaves ficam (são API dos chamadores); os valores viram token de estado —
// `success` / `insights` / `warning` respondem ao tema, o verde/azul crus não.
export const ACCENT = {
  emerald: {
    gradient: "from-success/5 to-transparent",
    iconBg: "bg-success/10",
    iconText: "text-success",
    ring: "stroke-success",
  },
  blue: {
    gradient: "from-insights/5 to-transparent",
    iconBg: "bg-insights/10",
    iconText: "text-insights",
    ring: "stroke-insights",
  },
  amber: {
    gradient: "from-warning/5 to-transparent",
    iconBg: "bg-warning/15",
    iconText: "text-warning-strong",
    ring: "stroke-warning",
  },
  destructive: {
    gradient: "from-destructive/5 to-transparent",
    iconBg: "bg-destructive/10",
    iconText: "text-destructive",
    ring: "stroke-destructive",
  },
} as const;
