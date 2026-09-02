/**
 * upsertCanonicalClient — canonical client reconciliation (módulo E, ADR-0020).
 *
 * Pure logic over a ClientStore port, so it is testable without a database.
 * - Match: by (org, external_id) first, then by (org, cnpj).
 * - enrich_only (default): fill only EMPTY CRM fields; never overwrite curated
 *   data (name, etc). Unmatched clients are skipped (no creation).
 * - canonical: overwrite client fields on match; create when unmatched.
 * - Idempotent on (org, external_id): re-running enriches, never duplicates.
 *
 * Lead resolution: a Carteira Client cannot exist without a lead_id (NOT NULL),
 * so creating an unmatched ERP client first resolves/creates a stub lead.
 */

import { CanonicalClient } from "../types.ts";
import { type OwnerMap } from "./owner-map.ts";
import {
  clientEnrichmentColumns,
  erpDateToTimestamp,
  leadEnrichmentColumns,
  seedLastOrderAt,
} from "./client-enrichment.ts";

export type ErpSyncMode = "off" | "enrich_only" | "canonical";

export interface ExistingClient {
  id: string;
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  name: string | null;
  /**
   * Identidade externa já gravada. Opcional para não quebrar chamadores
   * antigos; quando presente, permite detectar que NADA mudaria e pular a
   * escrita — ver `upsertCanonicalClient`.
   */
  external_source?: string | null;
  external_id?: string | null;
  external_ref?: string | null;

  /**
   * Enriquecimento já gravado. Tem a MESMA função dos `external_*` acima: sem
   * estes campos no que o store devolve, a comparação de "mudou alguma coisa?"
   * nunca acha o valor atual, conclui que mudou e reescreve todo cliente a cada
   * execução — que é exatamente o que estourou o teto de 150s do gateway.
   */
  erp_company?: string | null;
  erp_owner_name?: string | null;
  erp_owner_external_id?: string | null;
  erp_status?: string | null;
  erp_segment?: string | null;
  erp_registered_at?: string | null;
  erp_last_order_at?: string | null;
  erp_city?: string | null;
  erp_uf?: string | null;
  erp_metadata?: Record<string, unknown> | null;

  /**
   * Métrica da carteira, não espelho do ERP. Entra aqui só para que a semeadura
   * saiba se já existe informação mais nova — ver `seedLastOrderAt`.
   */
  last_order_at?: string | null;
}

/**
 * Serialização estável para comparar JSONB.
 *
 * `erp_metadata` é objeto, e `a !== b` entre dois objetos é SEMPRE verdadeiro —
 * a comparação ingênua marcaria todo cliente como alterado. Comparar o JSON
 * também não basta cru: o Postgres devolve JSONB com as chaves reordenadas
 * (por tamanho, depois byte a byte), então a mesma informação volta numa ordem
 * diferente da que gravamos. Ordenar as chaves antes resolve os dois.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

function sameValue(current: unknown, next: unknown): boolean {
  if (current === next) return true;
  if (typeof current === "object" && current !== null && typeof next === "object" && next !== null) {
    return stableStringify(current) === stableStringify(next);
  }
  return false;
}

export interface ClientStore {
  findByExternalId(organizationId: string, externalId: string): Promise<ExistingClient | null>;
  findByCnpj(organizationId: string, cnpj: string): Promise<ExistingClient | null>;
  enrich(id: string, patch: Record<string, unknown>): Promise<void>;
  createLead(
    organizationId: string,
    lead: {
      name: string;
      company: string | null;
      phone: string | null;
      email: string | null;
      /** Colunas extras do lead vindas do ERP (segmento, UF). Opcional. */
      extra?: Record<string, unknown>;
    },
  ): Promise<string>;
  createClient(row: Record<string, unknown>): Promise<string>;
}

export interface UpsertClientParams {
  organizationId: string;
  source: string;
  client: CanonicalClient;
  syncMode: ErpSyncMode;
  /**
   * De-para de representante do ERP → team member.
   *
   * Ausente = `responsible_id` não é tocado, que é o comportamento de sempre.
   * Pesa mais aqui do que na criação: a reconciliação passa por TODOS os
   * clientes a cada volta, então mapa mal preenchido redistribuiria a carteira
   * inteira toda madrugada — e mudança de dono é mudança de visibilidade.
   */
  ownerMap?: OwnerMap;
}

export type UpsertClientResult =
  | { action: "skipped"; reason: string }
  | { action: "enriched"; clientId: string }
  | { action: "created"; clientId: string };

export async function upsertCanonicalClient(
  store: ClientStore,
  params: UpsertClientParams,
): Promise<UpsertClientResult> {
  const { organizationId, source, client, syncMode } = params;

  if (syncMode === "off") return { action: "skipped", reason: "mode_off" };

  const existing =
    (await store.findByExternalId(organizationId, client.externalId)) ??
    (client.cnpj ? await store.findByCnpj(organizationId, client.cnpj) : null);

  // Always (re)stamp the external identity so a CNPJ-matched row adopts the id.
  const stamp = {
    external_source: source,
    external_id: client.externalId,
    external_ref: client.externalRef,
  };

  /**
   * Enriquecimento acompanha o carimbo, nos DOIS modos.
   *
   * Os campos `erp_*` são espelho do ERP: não há tela onde alguém os cure, e não
   * existe versão "do CRM" deles para proteger. A regra do `enrich_only` — só
   * preencher o que está vazio — existe para não sobrescrever trabalho humano,
   * e aqui não há trabalho humano a sobrescrever. Tratá-los como campo curado
   * congelaria o representante na primeira sincronização e o cliente ficaria
   * com o vendedor errado para sempre.
   */
  const enrichment = clientEnrichmentColumns(client, params.ownerMap);

  if (existing) {
    const patch: Record<string, unknown> = { ...stamp, ...enrichment };

    // A data do ERP também alimenta a métrica da carteira, mas só para frente e
    // só quando é notícia — ver `seedLastOrderAt`.
    const seeded = seedLastOrderAt(client.lastOrderAt, existing.last_order_at);
    if (seeded) patch.last_order_at = seeded;

    if (syncMode === "canonical") {
      patch.name = client.name;
      patch.company = client.company;
      patch.email = client.email;
      patch.phone = client.phone;
      patch.cnpj = client.cnpj;
    } else {
      // enrich_only: fill only empty fields; the curated name is never touched.
      if (!existing.cnpj && client.cnpj) patch.cnpj = client.cnpj;
      if (!existing.phone && client.phone) patch.phone = client.phone;
      if (!existing.email && client.email) patch.email = client.email;
      if (!existing.company && client.company) patch.company = client.company;
    }

    // Escrita só quando algo muda de fato.
    //
    // Sem isto, RE-sincronizar é O(n) de UPDATEs inúteis: na segunda execução
    // da carga da Café Jurerê, 12.608 clientes já existentes viraram 12.608
    // updates idênticos e a função estourou o teto de 150s do gateway (HTTP
    // 504). Cada update ainda dispara auditoria e evento de Realtime, então o
    // custo não é só a ida ao banco.
    //
    // Quando o chamador não informa a identidade externa atual (`external_*`
    // ausente no `ExistingClient`), a comparação do carimbo é pulada e o
    // comportamento continua o de antes: escreve.
    const changed = Object.entries(patch).filter(([key, value]) => {
      const current = (existing as unknown as Record<string, unknown>)[key];
      return current === undefined ? true : !sameValue(current, value);
    });

    if (changed.length === 0) {
      return { action: "skipped", reason: "no_changes" };
    }

    await store.enrich(existing.id, Object.fromEntries(changed));
    return { action: "enriched", clientId: existing.id };
  }

  // Unmatched: enrich_only never creates — it only enriches what already exists.
  if (syncMode !== "canonical") {
    return { action: "skipped", reason: "unmatched" };
  }

  // canonical + unmatched: resolve a lead first (lead_id is NOT NULL), then create.
  const leadId = await store.createLead(organizationId, {
    name: client.name,
    company: client.company,
    phone: client.phone,
    email: client.email,
    extra: leadEnrichmentColumns(client, source),
  });
  const clientId = await store.createClient({
    organization_id: organizationId,
    lead_id: leadId,
    name: client.name,
    company: client.company,
    cnpj: client.cnpj,
    phone: client.phone,
    email: client.email,
    is_active: true,
    ...stamp,
    ...enrichment,
    // Cliente nascendo: não há métrica anterior para preservar, então a data do
    // ERP entra direto e o cliente já chega à carteira com recência.
    ...(client.lastOrderAt ? { last_order_at: erpDateToTimestamp(client.lastOrderAt) } : {}),
  });
  return { action: "created", clientId };
}
