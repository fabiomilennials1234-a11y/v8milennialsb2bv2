/**
 * Manifesto de capacidades do Toth (ADR-0020 §1).
 *
 * `clientes` (GET /clientes) e `receivables` (POST /cobrancas). A UI da Carteira
 * lê o manifesto para decidir quais superfícies mostrar — declarar capacidade
 * antes de o endpoint existir faria a tela prometer dado que nunca chega.
 *
 * NÃO declara `pedidos`, `notaFiscal` nem `produtos`: esses endpoints ainda não
 * existem. O fornecedor se ofereceu a construí-los sob medida ("pode passar os
 * parâmetros e o retorno desejado"), então a lista cresce quando chegarem —
 * mapeados e testados, nunca antes.
 *
 * ⚠️ `receivables` chega SEM data de pagamento: o retorno traz `valorPago`, e
 * daí `pagoEm` é sempre null e pagamento parcial não vira `pago`. Ver
 * `deriveTituloStatus` em toth-mappers.ts.
 */

import type { ERPProvider } from "./erp-provider.ts";

export const TOTH_PROVIDER_ID = "toth";

export const tothProvider: ERPProvider = {
  id: TOTH_PROVIDER_ID,
  capabilities: ["clientes", "receivables"],
};
