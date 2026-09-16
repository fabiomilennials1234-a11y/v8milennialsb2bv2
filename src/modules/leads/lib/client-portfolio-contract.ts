import { z } from "zod";
import type { LeadsFilterParams } from "../hooks/useLeads";
import { normalizeLeadSort } from "./lead-list-sort";

export const portfolioSegmentSchema = z.enum([
  "all",
  "none",
  "ouro",
  "prata",
  "bronze",
  "novo",
  "resgate",
  "dormindo",
]);
export const portfolioReorderSchema = z.enum([
  "all",
  "late",
  "soon",
  "on-time",
  "unknown",
]);
export type PortfolioSegment = z.infer<typeof portfolioSegmentSchema>;
export type PortfolioReorder = z.infer<typeof portfolioReorderSchema>;
const number = z.number().finite();
export const clientPortfolioPageSchema = z.object({
  asOf: z.string().datetime({ offset: true }),
  total: number.int().nonnegative(),
  summary: z.object({
    monthlyRevenue: number,
    expectedCount: number.int().nonnegative(),
    overdueCount: number.int().nonnegative(),
  }),
  clients: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      company: z.string().nullable(),
      identity: z.string().nullable(),
      firstPurchaseAt: z.string().nullable(),
      lastPurchaseAt: z.string().nullable(),
      nextPurchaseAt: z.string().nullable(),
      metrics: z.object({
        leadId: z.string().uuid(),
        lifetimeValue: number,
        avgTicket: number,
        orderCount: number.int().nonnegative(),
        reorderCycleDays: number.nullable(),
        daysSinceLastOrder: number.nullable(),
        segment: z.string().nullable(),
      }),
      cycle: z.object({
        estado: z.enum(["sem-compra", "uma-compra", "com-ciclo"]),
        compras: number.int().nonnegative(),
        mediaDias: number.nullable(),
        diasDesdeUltima: number.nullable(),
        diasRestantes: number.nullable(),
        progresso: number.min(0).max(1),
        emEpoca: z.boolean(),
        rotulo: z.string(),
      }),
    }),
  ),
});
export type ClientPortfolioPage = z.infer<typeof clientPortfolioPageSchema>;
export type PortfolioSummary = ClientPortfolioPage["summary"];
/** Whitelist persisted values before they cross the RPC boundary. */
export function portfolioFilters(
  filters: LeadsFilterParams,
  segment: PortfolioSegment,
  reorder: PortfolioReorder,
) {
  const sort = normalizeLeadSort(filters.sort);
  const owner = filters.filterResponsible;
  return {
    source: filters.usaCadastroErpCafeJurere
      ? "cafe"
      : filters.usaLeiDoErp
        ? "erp"
        : "relationship",
    segment,
    reorder,
    sort: sort.key,
    direction: sort.direction,
    search: filters.searchQuery?.trim().slice(0, 250) || undefined,
    origin: filters.filterOrigin || "all",
    qualification: filters.filterQualification || "all",
    responsible:
      owner === "none" || z.string().uuid().safeParse(owner).success
        ? owner
        : "all",
    uf: filters.filterUf || undefined,
    createdFrom: filters.createdFrom,
    createdTo: filters.createdTo,
    unassigned: filters.filterAssignment === "unassigned",
  };
}
