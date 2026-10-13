import type { TicketSeveridade } from "@/modules/platform/lib/support-ticket-draft";
import type { DiagnosisKind } from "./ticket-diagnosis";

/** O tom de cada severidade, igual na gaveta e no cartão do kanban. */
export const SEVERIDADE_TONE: Record<TicketSeveridade, string> = {
  baixa: "border-transparent bg-muted text-muted-foreground",
  media: "border-transparent bg-insights/10 text-insights",
  alta: "border-transparent bg-warning/15 text-warning-strong",
  critica: "border-transparent bg-destructive/10 text-destructive",
};

/**
 * O cartão do kanban se pinta pelo que o diagnóstico disse que o chamado é:
 * fix em âmbar, feature em azul. A tinta vai num `background-image` por cima
 * do `bg-card` — sozinha, uma cor translúcida deixaria a coluna vazar pelo
 * cartão. Configuração e dúvida ficam no cartão neutro.
 */
export const KIND_CARD_TONE: Partial<Record<DiagnosisKind, string>> = {
  fix: "border-warning/40 [background-image:linear-gradient(hsl(var(--warning)/0.10),hsl(var(--warning)/0.10))]",
  feature: "border-insights/35 [background-image:linear-gradient(hsl(var(--insights)/0.08),hsl(var(--insights)/0.08))]",
};

/** O selo de tipo no cartão, no mesmo tom do cartão. */
export const KIND_BADGE_TONE: Partial<Record<DiagnosisKind, string>> = {
  fix: "border-transparent bg-warning/15 text-warning-strong",
  feature: "border-transparent bg-insights/10 text-insights",
};
