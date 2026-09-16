import type { LeadCarteiraMetrics } from "../../hooks/useLeadsCarteiraMetrics";
import type { LeadDeal } from "../../hooks/useLeadsDeals";
import type { CicloDeRecompra } from "../../lib/reorder-cycle";

export interface PortfolioClient {
  id: string;
  name: string;
  company: string | null;
  identity: string | null;
  firstPurchaseAt?: string | null;
  lastPurchaseAt?: string | null;
  nextPurchaseAt?: string | null;
  metrics?: LeadCarteiraMetrics;
  cycle?: CicloDeRecompra;
  deals: LeadDeal[];
}
export interface PortfolioPurchase {
  id: string;
  date: string;
  value: number;
  source: "CRM" | "Carteira";
}
export type ReorderStatus = "late" | "soon" | "on-time" | "unknown";
export function reorderStatus(cycle?: CicloDeRecompra): ReorderStatus {
  if (cycle?.diasRestantes == null) return "unknown";
  return cycle.diasRestantes < 0
    ? "late"
    : cycle.diasRestantes <= 7
      ? "soon"
      : "on-time";
}
export function reorderLabel(cycle?: CicloDeRecompra): string {
  const days = cycle?.diasRestantes;
  if (days == null)
    return cycle?.compras === 1
      ? "Aguardando segunda compra"
      : "Sem histórico suficiente";
  if (days < 0)
    return `${Math.abs(days)} ${days === -1 ? "dia" : "dias"} em atraso`;
  if (days === 0) return "Previsto para hoje";
  if (days <= 7) return `Previsto em ${days} ${days === 1 ? "dia" : "dias"}`;
  return "No ciclo";
}
/** Same UTC calendar-day contract as calcularCicloDeRecompra; never shift in browser timezone. */
export function cycleDate(
  offset: number | null | undefined,
  now: number,
): string | null {
  if (offset == null) return null;
  const day = Math.floor(now / 86_400_000) + offset;
  return new Date(day * 86_400_000).toISOString();
}
export function portfolioDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(value))
    .replace(".", "")
    .replace(" de ", " ");
}
export const SEGMENTS: Record<string, { label: string; tone: string }> = {
  ouro: {
    label: "Ouro",
    tone: "border-primary/35 bg-primary/10 text-warning-strong dark:text-primary",
  },
  prata: {
    label: "Prata",
    tone: "border-silver/35 bg-silver/10 text-muted-foreground",
  },
  bronze: {
    label: "Bronze",
    tone: "border-warning/35 bg-warning/10 text-warning-strong",
  },
  novo: {
    label: "Novo",
    tone: "border-border bg-muted/40 text-muted-foreground",
  },
  resgate: {
    label: "Resgate",
    tone: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  dormindo: {
    label: "Dormindo",
    tone: "border-border bg-muted/40 text-muted-foreground",
  },
};
export function filterPortfolio(
  clients: PortfolioClient[],
  segment: string,
  status: string,
): PortfolioClient[] {
  return clients.filter(
    (c) =>
      (segment === "all" || (c.metrics?.segment ?? "none") === segment) &&
      (status === "all" || reorderStatus(c.cycle) === status),
  );
}
