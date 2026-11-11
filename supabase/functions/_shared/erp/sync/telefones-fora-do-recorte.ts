/**
 * Telefones de cliente FORA do recorte da Café Jurerê (flag
 * `erp_telefones_todos_clientes`).
 *
 * O recorte (situações 0/3 e representante vinculado) decide quem a
 * sincronização enriquece, cria e atribui. Não deveria decidir se o telefone do
 * cliente chega ao CRM: medido em 10/11, 9.370 dos 13.092 clientes do ERP
 * ficavam fora, com lead, e nunca recebiam telefone novo ou trocado — a
 * conversa desse número ficava sem lead.
 *
 * Aqui sai SÓ o item de telefones, e só de quem já tem lead. Nada de enriquecer,
 * criar ou trocar dono. A reconciliação (`syncLeadPhonesFromErp`) só insere e
 * completa: nunca apaga, nunca mexe no principal, não ressuscita o que o
 * usuário apagou.
 */
import type { CanonicalClient } from "../types.ts";
import type { ClientStore } from "./upsert-client.ts";
import type { LeadPhonesSyncItem } from "./lead-phones-sync.ts";

export async function telefonesDeClienteForaDoRecorte(input: {
  ligado: boolean;
  dryRun: boolean;
  organizationId: string;
  cliente: Pick<CanonicalClient, "externalId" | "cnpj" | "phones">;
  store: Pick<ClientStore, "findByExternalId" | "findByCnpj">;
  /** Clientes já enfileirados nesta execução (o ERP pode repetir linha). */
  vistos: Set<string>;
}): Promise<LeadPhonesSyncItem | null> {
  const { ligado, dryRun, organizationId, cliente, store, vistos } = input;
  if (!ligado || dryRun) return null;
  if (!cliente.phones?.length) return null;
  if (vistos.has(cliente.externalId)) return null;
  vistos.add(cliente.externalId);

  const existente =
    (await store.findByExternalId(organizationId, cliente.externalId)) ??
    (cliente.cnpj ? await store.findByCnpj(organizationId, cliente.cnpj) : null);
  if (!existente?.lead_id) return null;
  return { leadId: existente.lead_id, phones: cliente.phones };
}
