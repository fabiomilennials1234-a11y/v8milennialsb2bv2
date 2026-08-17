/**
 * Manifesto de capacidades do Toth (ADR-0020 §1).
 *
 * Declara SÓ `clientes`, porque é só isso que a documentação recebida cobre
 * (`POST /users/login` + `GET /clientes`). A UI da Carteira lê o manifesto para
 * decidir quais superfícies mostrar — declarar `pedidos` ou `receivables` aqui
 * antes de o endpoint existir faria a tela prometer dado que nunca chega.
 *
 * Ampliar este array é o último passo de cada fase, não o primeiro: só depois
 * de o endpoint estar confirmado, mapeado e testado.
 */

import type { ERPProvider } from "./erp-provider.ts";

export const TOTH_PROVIDER_ID = "toth";

export const tothProvider: ERPProvider = {
  id: TOTH_PROVIDER_ID,
  capabilities: ["clientes"],
};
