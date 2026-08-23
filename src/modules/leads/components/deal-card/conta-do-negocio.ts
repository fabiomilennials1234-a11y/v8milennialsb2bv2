import type { DealCardItem } from "./types";

/**
 * A conta do negócio, num lugar só.
 *
 * Existe porque o ladrilho "Valor Total" do topo e o "Total" do bloco de
 * dinheiro PRECISAM ser o mesmo número. Cada um calculando o seu é como o
 * painel passa a mostrar dois valores para o mesmo negócio — e aí não há qual
 * acreditar.
 *
 * ⚠ O total é derivado AQUI, nunca lido de `deals.value`: o trigger
 * `trg_deal_items_sync_value` reescreve aquela coluna a partir de `deal_items`
 * a cada toque num item, e apagaria qualquer ajuste em silêncio.
 *
 * Mora em arquivo próprio, e não junto do componente, porque um módulo que
 * exporta componente E função quebra o Fast Refresh do Vite
 * (`react-refresh/only-export-components`).
 */
export function contaDoNegocio(
  itens: DealCardItem[],
  valorDoNegocio: number | null,
  /** `metadata.sale_value` do funil — último recurso, e só quando há. */
  valorDoFunil = 0,
) {
  // Bruto = o que os itens somariam sem abatimento. O desconto do negócio é a
  // diferença até o total gravado, que é coluna GENERATED e já é a verdade.
  const bruto = itens.reduce((s, i) => s + i.precoUnitario * i.quantidade, 0);
  const liquido = itens.reduce((s, i) => s + i.total, 0);
  const temItens = itens.length > 0;
  return {
    temItens,
    desconto: Math.max(0, bruto - liquido),
    total: temItens ? liquido : (valorDoNegocio ?? (valorDoFunil > 0 ? valorDoFunil : 0)),
  };
}
