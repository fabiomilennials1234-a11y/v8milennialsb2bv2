/**
 * upsertCanonicalOrder — canonical order reconciliation (módulo E, ADR-0020).
 *
 * Pure logic over an OrderStore port. An ERP order attaches to an already-synced
 * Carteira Client (resolved by the order's client external id); if the client is
 * not synced yet it is skipped (clientes sync runs first). Orders land as
 * source='erp' and approval_status='approved' so they count in Carteira metrics
 * (see the carteira "venda manual auto-aprovada" gotcha). Idempotent on
 * (org, source, external_id).
 */

import { CanonicalOrder, CanonicalOrderItem } from "../types.ts";

export interface OrderStore {
  findClientIdByExternalId(
    organizationId: string,
    source: string,
    clientExternalId: string,
  ): Promise<string | null>;
  /**
   * Recuo quando o pedido só traz o documento do cliente.
   *
   * `/pedidos` do Toth identifica o cliente por `numeroinscricao`; sem este
   * caminho, todo pedido cairia em `client_not_synced` e a sincronização
   * devolveria zero com cara de sucesso.
   */
  findClientIdByCnpj?(organizationId: string, cnpj: string): Promise<string | null>;
  findOrderByExternalId(
    organizationId: string,
    source: string,
    externalId: string,
  ): Promise<{ id: string } | null>;
  updateOrder(id: string, patch: Record<string, unknown>): Promise<void>;
  createOrder(row: Record<string, unknown>): Promise<string>;
  /**
   * Substitui os itens do pedido. Opcional: providers sem itens (Omie hoje) não
   * implementam, e o upsert simplesmente não chama.
   */
  replaceOrderItems?(params: {
    organizationId: string;
    orderId: string;
    source: string;
    items: CanonicalOrderItem[];
  }): Promise<void>;
}

/**
 * Situações que encerram o pedido — não viraram receita e não vão virar.
 *
 * O vocabulário completo veio do enum `StatusPedido` do fonte do Toth, que o
 * fornecedor enviou em 01/09: NORMAL(0) · BLOQUEADO(1) · DEVOLVIDO(2) ·
 * CANCELADO(3) · FATURADO(4) · BAIXADO(5) · PENDENTE_ANALISE(6) ·
 * FATURADO_PARCIAL(7) · DEVOLVIDO_PARCIAL(8) · FATURADO_COMPATIBILIDADE(9).
 * Até então conhecíamos DOIS valores, os que apareceram numa amostra de dez.
 *
 * Peso real, medido em 554 pedidos da Café Jurerê (jun–ago/2026):
 * FATURADO 405 · **CANCELADO 122** · NORMAL 39 · DEVOLVIDO 8 ·
 * FATURADO_PARCIAL 2. Cancelado é 22% do volume — deixá-lo em `pending`
 * encheria a ficha do cliente de "carteira em formação" que já morreu.
 */
const SITUACOES_ENCERRADAS = new Set(["CANCELADO", "DEVOLVIDO"]);

/**
 * Situação do ERP → `approval_status` da Carteira.
 *
 * 🔴 É aqui que se decide o que conta como receita. A Carteira soma
 * `upsell_orders` aprovados, e são três destinos:
 *
 * - **`approved`** — `FATURADO`/`APROVADO`: venda consumada, entra na conta.
 * - **`rejected`** — `CANCELADO`/`DEVOLVIDO`: encerrado sem receita. Continua
 *   registrado, porque o histórico do cliente é informação, mas fora da conta.
 * - **`pending`** — o resto (`NORMAL`, `BLOQUEADO`, `PENDENTE_ANALISE`,
 *   `BAIXADO`, os parciais): carteira em formação. Aparece na ficha, não conta.
 *
 * ⚠️ **`FATURADO_PARCIAL` fica em `pending`, e isso é limitação da API, não
 * escolha de produto.** A decisão do CTO em 01/09 foi que parcial entrasse
 * proporcional — mas o payload de `/flow/crm/pedidos` traz só `qtdpedido` e
 * `valorunitario`, **sem nenhum campo de quantidade ou valor FATURADO**
 * (verificado nos 554 pedidos: os campos de item são exatamente
 * `codigoproduto`, `descricaoproduto`, `qtdpedido`, `valorunitario`). Sem saber
 * quanto do pedido virou nota, qualquer proporção seria inventada — e receita
 * inventada é pior que receita adiada. Enquanto o fornecedor não expuser
 * `qtdFaturada`/`valorFaturado`, `pending` é a resposta honesta; custa 2
 * pedidos em 554 (0,4%).
 *
 * Provider sem situação (Omie) segue aprovado, como sempre foi.
 */
export function approvalForErpStatus(erpStatus: string | null | undefined): string {
  if (!erpStatus) return "approved";
  const normalized = erpStatus.trim().toUpperCase();
  if (normalized === "FATURADO" || normalized === "APROVADO") return "approved";
  if (SITUACOES_ENCERRADAS.has(normalized)) return "rejected";
  return "pending";
}

export interface UpsertOrderParams {
  organizationId: string;
  source: string;
  order: CanonicalOrder;
}

export type UpsertOrderResult =
  | { action: "skipped"; reason: string }
  | { action: "updated"; orderId: string }
  | { action: "created"; orderId: string };

export async function upsertCanonicalOrder(
  store: OrderStore,
  params: UpsertOrderParams,
): Promise<UpsertOrderResult> {
  const { organizationId, source, order } = params;

  if (!order.externalId) return { action: "skipped", reason: "no_external_id" };
  // sale_value has a CHECK (> 0); a zero/negative order is a quote, not a sale.
  if (!(order.saleValue > 0)) return { action: "skipped", reason: "zero_value" };

  const clientId =
    (order.clientExternalId
      ? await store.findClientIdByExternalId(organizationId, source, order.clientExternalId)
      : null) ??
    (order.clientCnpj && store.findClientIdByCnpj
      ? await store.findClientIdByCnpj(organizationId, order.clientCnpj)
      : null);
  if (!clientId) return { action: "skipped", reason: "client_not_synced" };

  const stamp = {
    external_source: source,
    external_id: order.externalId,
    external_ref: order.externalRef,
  };

  const approval = approvalForErpStatus(order.erpStatus);

  const existing = await store.findOrderByExternalId(organizationId, source, order.externalId);
  if (existing) {
    await store.updateOrder(existing.id, {
      ...stamp,
      sale_value: order.saleValue,
      product_name: order.productName,
      // A situação muda com o tempo — `NORMAL` vira `FATURADO` quando a nota
      // sai —, e é essa virada que faz o pedido passar a contar como receita.
      // Reconciliar sem atualizá-la deixaria a venda pendente para sempre.
      ...(order.erpStatus === undefined
        ? {}
        : { erp_status: order.erpStatus, approval_status: approval }),
      // `sold_at` não entra: a data de emissão não muda, e reescrevê-la a cada
      // volta moveria a venda de mês se o ERP corrigisse o fuso.
    });
    await writeItems(store, organizationId, existing.id, source, order);
    return { action: "updated", orderId: existing.id };
  }

  const row: Record<string, unknown> = {
    organization_id: organizationId,
    client_id: clientId,
    product_name: order.productName,
    product_type: "unitario",
    sale_value: order.saleValue,
    origin: "upsell",
    source: "erp",
    approval_status: approval,
    ...stamp,
  };
  if (order.soldAt) row.sold_at = order.soldAt;
  if (order.erpStatus !== undefined) row.erp_status = order.erpStatus;

  const orderId = await store.createOrder(row);
  await writeItems(store, organizationId, orderId, source, order);
  return { action: "created", orderId };
}

/**
 * Grava os itens, quando existem e quando o store sabe gravá-los.
 *
 * Erro aqui SOBE, e o chamador conta o pedido como falho — mas o pedido já está
 * gravado, e o upsert é idempotente em (org, source, external_id): a próxima
 * execução reencontra a venda e regrava só os itens. Engolir a falha seria pior,
 * porque um pedido sem itens é indistinguível de um pedido que não tinha itens.
 */
async function writeItems(
  store: OrderStore,
  organizationId: string,
  orderId: string,
  source: string,
  order: CanonicalOrder,
): Promise<void> {
  if (!store.replaceOrderItems || !order.items || order.items.length === 0) return;
  await store.replaceOrderItems({ organizationId, orderId, source, items: order.items });
}
