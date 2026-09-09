/**
 * Montagem de pedido cortado na fronteira de página do Flow.
 *
 * 🔴 Medido em 01/09 contra o serviço real: a página de `/flow/crm/pedidos` é de
 * **25 ITENS**, não de 25 pedidos. Cada página trouxe exatamente 25 itens em 9 a
 * 13 pedidos, e em todas as fronteiras testadas (1×2, 2×3, 3×4, 4×5) um
 * `numeropedido` apareceu nas DUAS páginas, com os itens repartidos e o
 * `valortotalliquido` repetido inteiro em cada fatia.
 *
 * Estas funções são puras de propósito: vivem fora do `index.ts` da edge
 * function porque lá o módulo chama `Deno.serve` ao carregar, e teste não sobe
 * servidor.
 */

/**
 * Chaves que carregam o número do pedido, em caixa baixa e sem separador.
 *
 * A resposta do Flow vem em caixa baixa colada (`numeropedido`), ao contrário
 * de `/clientes`. Normalizar aqui em vez de casar exato evita que uma mudança
 * de caixa no lado deles quebre a montagem em silêncio — e "sem número" é
 * justamente o caso em que o pedido não pode ser deduplicado.
 */
const NUMERO_PEDIDO_KEYS = new Set([
  "numeropedido",
  "numeropedidovenda",
  "codigopedido",
  "numero",
]);

const normalizarChave = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Número do pedido, ou `null` quando a linha não traz nenhum. */
export function numeroDoPedido(row: Record<string, unknown>): string | null {
  for (const [chave, valor] of Object.entries(row)) {
    if (!NUMERO_PEDIDO_KEYS.has(normalizarChave(chave))) continue;
    const texto = String(valor ?? "").trim();
    if (texto) return texto;
  }
  return null;
}

/** Nome da chave que carrega os itens nesta linha (o mapeador aceita três). */
function chaveDosItens(row: Record<string, unknown>): string | null {
  for (const chave of Object.keys(row)) {
    const n = normalizarChave(chave);
    if (n === "itens" || n === "items" || n === "produtos") return chave;
  }
  return null;
}

/**
 * Junta duas fatias do MESMO pedido vindas de páginas diferentes.
 *
 * Só os itens se acumulam. Os campos de cabeçalho vêm repetidos e idênticos nas
 * duas fatias — medido: `valortotalliquido` 32.031 aparece igual na página 2 e
 * na 3 do pedido 24243 —, então a fatia mais recente sobrescrever a anterior é
 * indiferente. Somar o total, por outro lado, dobraria a receita.
 */
export function mesclarFatias(
  anterior: Record<string, unknown> | undefined,
  nova: Record<string, unknown>,
): Record<string, unknown> {
  if (!anterior) return nova;

  const chaveA = chaveDosItens(anterior);
  const chaveB = chaveDosItens(nova);
  const itensA = chaveA && Array.isArray(anterior[chaveA]) ? (anterior[chaveA] as unknown[]) : [];
  const itensB = chaveB && Array.isArray(nova[chaveB]) ? (nova[chaveB] as unknown[]) : [];

  const juntos = { ...anterior, ...nova };
  const destino = chaveB ?? chaveA;
  if (destino) juntos[destino] = [...itensA, ...itensB];
  return juntos;
}
