/**
 * Analytics Design Tokens
 * Escala tipográfica e cores semânticas unificadas para toda a seção Analytics.
 * Importar AT e ACCENT em todos os componentes analytics — nenhum desvio permitido.
 */

export const AT = {
  metricLabel: "text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground",
  metricSublabel: "text-[10px] text-muted-foreground/60",
  chartTitle: "text-sm font-semibold tracking-[-0.01em]",
  chartSubtitle: "text-xs text-muted-foreground/50",
  valueLg: "text-3xl font-extrabold tracking-[-0.04em] tabular-nums",
  valueMd: "text-xl font-bold tracking-[-0.02em] tabular-nums",
  valueSm: "text-sm font-semibold tabular-nums",
  sectionHeading: "text-lg font-semibold tracking-[-0.02em]",
  sectionDesc: "text-sm text-muted-foreground/60",
} as const;

export type AccentColor = "emerald" | "blue" | "amber" | "destructive";

export const ACCENT = {
  emerald: {
    gradient: "from-emerald-500/5 to-transparent",
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-500",
    ring: "stroke-emerald-500",
  },
  blue: {
    gradient: "from-blue-500/5 to-transparent",
    iconBg: "bg-blue-500/10",
    iconText: "text-blue-500",
    ring: "stroke-blue-500",
  },
  amber: {
    gradient: "from-amber-500/5 to-transparent",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-500",
    ring: "stroke-amber-500",
  },
  destructive: {
    gradient: "from-destructive/5 to-transparent",
    iconBg: "bg-destructive/10",
    iconText: "text-destructive",
    ring: "stroke-destructive",
  },
} as const;
