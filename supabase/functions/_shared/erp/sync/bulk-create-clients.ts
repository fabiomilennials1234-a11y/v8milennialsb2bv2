/**
 * Criação de clientes de carteira em LOTE.
 *
 * `upsertCanonicalClient` cria um cliente por vez: dois INSERT sequenciais (lead
 * + cliente) por registro. Numa carga inicial de 12.608 clientes isso são 25.216
 * idas ao banco, e o Edge Runtime mata a execução muito antes disso.
 *
 * Aqui cada lote vira DOIS statements — um com N leads, outro com N clientes.
 * De 25.216 round-trips para ~50. Os gatilhos por linha continuam disparando
 * (auditoria, normalização de telefone, adoção de conversas órfãs); o que
 * desaparece é a latência de rede repetida, que era o gargalo real.
 *
 * ⚠️ Este caminho só cria. Enriquecimento de cliente existente continua em
 * `upsertCanonicalClient`, um a um — são poucos e a lógica de qual campo pode
 * ser sobrescrito não vale duplicar.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CanonicalClient } from "../types.ts";

/** Linhas por statement. */
export const DEFAULT_BATCH_SIZE = 500;

export interface BulkCreateResult {
  created: number;
  failed: number;
  errors: string[];
}

/**
 * Monta o par (lead, cliente) de um registro canônico.
 *
 * 🔑 O id do lead é gerado AQUI, não devolvido pelo banco.
 *
 * A alternativa seria inserir os leads e ler os ids de volta com `RETURNING`,
 * casando pela ordem. Mas a ordem de `RETURNING` não é garantida pelo padrão —
 * funciona na prática e falha em silêncio quando deixa de funcionar, e o modo de
 * falha é o pior possível: cliente A com o lead do cliente B, sem erro nenhum.
 * Gerando o uuid antes, os dois lados já nascem amarrados e não há ordem em que
 * confiar.
 */
export function buildClientRows(
  organizationId: string,
  source: string,
  client: CanonicalClient,
  leadId: string,
): { lead: Record<string, unknown>; carteira: Record<string, unknown> } {
  return {
    lead: {
      id: leadId,
      organization_id: organizationId,
      name: client.name,
      company: client.company,
      phone: client.phone,
      email: client.email,
      origin: `erp_${source}`,
    },
    carteira: {
      organization_id: organizationId,
      lead_id: leadId,
      name: client.name,
      company: client.company,
      cnpj: client.cnpj,
      phone: client.phone,
      email: client.email,
      is_active: true,
      external_source: source,
      external_id: client.externalId,
      external_ref: client.externalRef,
    },
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const step = size > 0 ? size : items.length || 1;
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

export async function bulkCreateClients(
  admin: SupabaseClient,
  params: {
    organizationId: string;
    source: string;
    clients: CanonicalClient[];
    batchSize?: number;
    newId?: () => string;
  },
): Promise<BulkCreateResult> {
  const { organizationId, source, clients } = params;
  const newId = params.newId ?? (() => crypto.randomUUID());
  const result: BulkCreateResult = { created: 0, failed: 0, errors: [] };

  for (const batch of chunk(clients, params.batchSize ?? DEFAULT_BATCH_SIZE)) {
    const rows = batch.map((c) => buildClientRows(organizationId, source, c, newId()));
    const leadIds = rows.map((r) => r.lead.id as string);

    const { error: leadErr } = await admin.from("leads").insert(rows.map((r) => r.lead));
    if (leadErr) {
      result.failed += batch.length;
      if (result.errors.length < 3) result.errors.push(`leads: ${leadErr.message}`);
      continue;
    }

    const { error: clientErr } = await admin
      .from("upsell_clients")
      .insert(rows.map((r) => r.carteira));

    if (clientErr) {
      // Lead sem cliente é órfão invisível: não aparece na carteira, mas conta
      // na lista de Leads e já adotou conversas órfãs pelo gatilho. Desfaz o
      // lote para que a falha não deixe rastro pela metade.
      await admin.from("leads").delete().in("id", leadIds);
      result.failed += batch.length;
      if (result.errors.length < 3) result.errors.push(`upsell_clients: ${clientErr.message}`);
      continue;
    }

    result.created += batch.length;
  }

  return result;
}
