import type { TicketSeveridade } from "@/modules/platform/lib/support-ticket-draft";

/** O tom de cada severidade, igual na gaveta e no cartão do kanban. */
export const SEVERIDADE_TONE: Record<TicketSeveridade, string> = {
  baixa: "border-transparent bg-muted text-muted-foreground",
  media: "border-transparent bg-insights/10 text-insights",
  alta: "border-transparent bg-warning/15 text-warning-strong",
  critica: "border-transparent bg-destructive/10 text-destructive",
};
