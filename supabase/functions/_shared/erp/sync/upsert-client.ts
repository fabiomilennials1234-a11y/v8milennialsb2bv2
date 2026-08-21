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
}

export interface ClientStore {
  findByExternalId(organizationId: string, externalId: string): Promise<ExistingClient | null>;
  findByCnpj(organizationId: string, cnpj: string): Promise<ExistingClient | null>;
  enrich(id: string, patch: Record<string, unknown>): Promise<void>;
  createLead(
    organizationId: string,
    lead: { name: string; company: string | null; phone: string | null; email: string | null },
  ): Promise<string>;
  createClient(row: Record<string, unknown>): Promise<string>;
}

export interface UpsertClientParams {
  organizationId: string;
  source: string;
  client: CanonicalClient;
  syncMode: ErpSyncMode;
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

  if (existing) {
    const patch: Record<string, unknown> = { ...stamp };
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
      return current === undefined ? true : current !== value;
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
  });
  return { action: "created", clientId };
}
