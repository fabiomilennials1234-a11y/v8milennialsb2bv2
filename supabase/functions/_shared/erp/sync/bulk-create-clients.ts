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
import { type OwnerMap } from "./owner-map.ts";
import {
  clientEnrichmentColumns,
  erpDateToTimestamp,
  leadEnrichmentColumns,
} from "./client-enrichment.ts";

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
  /**
   * `false` quando o telefone já pertence a outro lead da organização.
   *
   * 🔴 `idx_leads_org_phone_unique` é UNIQUE em (org, normalized_phone), e o
   * cadastro do Toth tem clientes distintos com o mesmo número. Como INSERT
   * multi-linha é atômico, uma única duplicata derrubava o lote de 500 inteiro —
   * foi o que fez 12.500 de 12.608 falharem na primeira carga.
   *
   * O telefone continua gravado no CLIENTE da carteira, que não tem essa
   * restrição; só o lead nasce sem ele. Reusar o mesmo lead para os dois
   * cadastros não é alternativa: `upsell_clients` é UNIQUE em (org, lead_id),
   * então um lead comporta um cliente só.
   *
   * Efeito colateral desejável: apenas o primeiro lead adota as conversas
   * órfãs daquele número, em vez de todos disputarem as mesmas mensagens.
   */
  phoneAvailable = true,
  /** De-para de representante. Ausente = nasce sem dono, como antes. */
  ownerMap?: OwnerMap,
): { lead: Record<string, unknown>; carteira: Record<string, unknown> } {
  return {
    lead: {
      id: leadId,
      organization_id: organizationId,
      name: client.name,
      company: client.company,
      phone: phoneAvailable ? client.phone : null,
      email: client.email,
      origin: `erp_${source}`,
      ...leadEnrichmentColumns(client, source),
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
      ...clientEnrichmentColumns(client, ownerMap),
      // Recência já na criação: sem isto o cliente entraria na carteira sem
      // "dias sem pedido", e a saúde só existiria depois que houvesse pedido
      // registrado no CRM — que para a Café Jurerê ainda não acontece.
      ...(client.lastOrderAt ? { last_order_at: erpDateToTimestamp(client.lastOrderAt) } : {}),
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
    /**
     * Telefones já pertencentes a leads da organização, normalizados como o
     * banco normaliza. Cresce durante a execução.
     */
    usedPhones?: Set<string>;
    /** Normalizador — espelho de `normalize_brazilian_phone`. */
    normalizePhone?: (phone: string | null) => string | null;
    /**
     * De-para de representante do ERP → team member.
     *
     * Ausente (o padrão) mantém o comportamento antigo: o cliente nasce sem
     * dono. Só código explicitamente mapeado ganha `responsible_id`.
     */
    ownerMap?: OwnerMap;
  },
): Promise<BulkCreateResult> {
  const { organizationId, source, clients } = params;
  const newId = params.newId ?? (() => crypto.randomUUID());
  const usedPhones = params.usedPhones ?? new Set<string>();
  const normalize = params.normalizePhone ?? ((p) => p);
  const result: BulkCreateResult = { created: 0, failed: 0, errors: [] };

  const insertBatch = async (batch: CanonicalClient[]): Promise<void> => {
    const rows = batch.map((c) => {
      const norm = c.phone ? normalize(c.phone) : null;
      const available = !norm || !usedPhones.has(norm);
      if (norm && available) usedPhones.add(norm);
      return buildClientRows(organizationId, source, c, newId(), available, params.ownerMap);
    });
    const leadIds = rows.map((r) => r.lead.id as string);

    const { error: leadErr } = await admin.from("leads").insert(rows.map((r) => r.lead));
    if (leadErr) return fail(batch, `leads: ${leadErr.message}`);

    const { error: clientErr } = await admin
      .from("upsell_clients")
      .insert(rows.map((r) => r.carteira));

    if (clientErr) {
      // Lead sem cliente é órfão invisível: não aparece na carteira, mas conta
      // na lista de Leads e já adotou conversas órfãs pelo gatilho. Desfaz o
      // lote para que a falha não deixe rastro pela metade.
      await admin.from("leads").delete().in("id", leadIds);
      return fail(batch, `upsell_clients: ${clientErr.message}`);
    }

    result.created += batch.length;
  };

  /**
   * Falhou: divide ao meio e tenta de novo, até isolar o registro problemático.
   *
   * INSERT multi-linha é atômico, então um registro ruim reprova o lote inteiro.
   * Sem isso, um único cliente com dado inesperado custava 500 — foi exatamente
   * o que aconteceu na primeira carga, onde 25 lotes cheios caíram e só o
   * último, de 108, passou. Dividir isola o culpado em log2(N) tentativas e
   * salva o resto.
   */
  const fail = async (batch: CanonicalClient[], message: string): Promise<void> => {
    if (batch.length === 1) {
      result.failed += 1;
      if (result.errors.length < 3) {
        result.errors.push(`${message} (externalId ${batch[0].externalId})`);
      }
      return;
    }
    const meio = Math.floor(batch.length / 2);
    await insertBatch(batch.slice(0, meio));
    await insertBatch(batch.slice(meio));
  };

  for (const batch of chunk(clients, params.batchSize ?? DEFAULT_BATCH_SIZE)) {
    await insertBatch(batch);
  }

  return result;
}
