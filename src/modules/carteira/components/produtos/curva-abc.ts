import { Box, FolderKanban, Repeat } from "lucide-react";
import type { ProductRankingItem } from "@/modules/carteira/hooks/useProductRanking";

export type ClasseAbc = "A" | "B" | "C";

export interface ItemAbc extends ProductRankingItem {
  classe: ClasseAbc;
  /** Fatia da receita do período (0–100). */
  share: number;
  posicao: number;
}

/**
 * Curva ABC sobre o ranking de produtos que o produto já calcula
 * (`get_product_ranking`): ordena por receita e corta em 80% (A) e 95% (B) da
 * receita acumulada. Pura — nenhum número novo, só a classificação.
 */
export function curvaAbc(items: ProductRankingItem[]): ItemAbc[] {
  const ordenados = [...items].filter((i) => Number(i.total_value) > 0).sort((a, b) => b.total_value - a.total_value);
  const total = ordenados.reduce((s, i) => s + Number(i.total_value), 0);
  let acumulado = 0;
  return ordenados.map((i, idx) => {
    const antes = acumulado;
    acumulado += Number(i.total_value);
    // A classe é decidida por onde o item COMEÇA na curva: o 1º é sempre A,
    // mesmo que sozinho passe de 80%.
    const inicio = total > 0 ? (antes / total) * 100 : 0;
    const classe: ClasseAbc = inicio < 80 ? "A" : inicio < 95 ? "B" : "C";
    return { ...i, classe, share: total > 0 ? (Number(i.total_value) / total) * 100 : 0, posicao: idx + 1 };
  });
}

export const TIPO_PRODUTO: Record<string, { label: string; icon: typeof Repeat; variant: "gold" | "info" | "soft" }> = {
  mrr: { label: "Recorrência", icon: Repeat, variant: "gold" },
  projeto: { label: "Projeto", icon: FolderKanban, variant: "info" },
  unitario: { label: "Unitário", icon: Box, variant: "soft" },
};

export function brlCompacto(v: number) {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
}

