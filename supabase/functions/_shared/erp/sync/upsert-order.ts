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
 * Situação do ERP → `approval_status` da Carteira.
 *
 * 🔴 É aqui que se decide o que conta como receita. O Toth devolve pedidos
 * `NORMAL` (emitido, ainda não faturado) junto com `FATURADO`, e a Carteira soma
 * `upsell_orders` aprovados. Aprovar tudo inflaria o faturamento com pedido que
 * pode ser cancelado antes de virar nota; recusar tudo esconderia a carteira em
 * formação.
 *
 * Faturado entra aprovado — é venda consumada. Qualquer outra situação entra
 * como pendente: aparece na ficha do cliente, não entra na conta.
 *
 * Provider sem situação (Omie) segue aprovado, como sempre foi.
 */
export function approvalForErpStatus(erpStatus: string | null | undefined): string {
  if (!erpStatus) return "approved";
  const normalized = erpStatus.trim().toUpperCase();
  return normalized === "FATURADO" || normalized === "APROVADO" ? "approved" : "pending";
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
