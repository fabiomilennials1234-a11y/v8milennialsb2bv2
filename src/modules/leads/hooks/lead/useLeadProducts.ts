/**
 * useLeadProducts — fachada sobre produtos vinculados a um lead.
 *
 * Onda 3.1, C11. Read-only nesta onda.
 * Produtos de um lead específico são gerenciados via /leads (Onda 3.2).
 * Este hook re-exporta useProducts para composição futura.
 */

export { useProducts, useProductsWithVariants } from "@/modules/carteira/hooks/useProducts";
