/**
 * Adoção de lead existente pela sincronização do ERP.
 *
 * Cliente do ERP sem linha na carteira nascia SEMPRE com lead novo. Mas o lead
 * pode já existir — importado por planilha, ou criado por um vendedor — e a
 * carteira só casa por `external_id` e CNPJ, que `leads` não guarda. Resultado
 * (dois cadastros da Café Jurerê, 21/10): o lead trabalhado, com funil e conversa,
 * ficava de um lado e um lead "do ERP" sem telefone, do outro.
 *
 * O lead do ERP nascia sem telefone por construção: `bulkCreateClients` tira o
 * número do lead novo quando ele já pertence a outro lead da org
 * (`idx_leads_org_phone_unique`). Essa colisão era o sinal de que o lead já
 * existia.
 *
 * Regra de adoção — as TRÊS condições, nunca uma só:
 *  1. mesmo telefone normalizado;
 *  2. nome compatível (ver `sameCompanyName`);
 *  3. o lead ainda não é de ninguém: sem `erp_code`, sem origem `erp_*` e sem
 *     linha em `upsell_clients`.
 *
 * Só o telefone não basta: o Telefone N:N existe porque empresas diferentes
 * dividem o mesmo número (13 pares na Café Jurerê), e adotar pelo número
 * fundiria clientes distintos. Sem nome compatível, cai no caminho de sempre.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CanonicalClient } from "../types.ts";

/** Lead que pode ser adotado, com o que já tem preenchido. */
export interface AdoptableLead {
  id: string;
  /** Preenchidos no lead: o ERP só completa o que está vazio. */
  hasSegment: boolean;
  hasUf: boolean;
}

/** Mínimo de caracteres do nome mais curto para aceitar "um contém o outro". */
const MIN_CONTAINED_LENGTH = 8;

/** Minúsculas, sem acento, só letras e dígitos separados por espaço único. */
export function normalizeName(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Prefixos que o ERP e a equipe põem no nome: código do cliente
 * ("3759- Pedro- EMPRESA X LTDA") e "INAPTA - ". Não identificam a
 * empresa e quebrariam a igualdade.
 */
function stripNoise(normalized: string): string {
  return normalized.replace(/^(inapta|inativo|inativa)\s+/, "").replace(/^\d+\s+/, "");
}

/**
 * Os dois nomes são da mesma empresa?
 *
 * Igualdade depois de normalizar, ou um contido no outro quando o menor tem ao
 * menos {@link MIN_CONTAINED_LENGTH} caracteres. O piso evita que "rafael"
 * absorva "rafael distribuidora" — nome curto demais não prova nada.
 */
export function sameCompanyName(
  a: { name?: string | null; company?: string | null },
  b: { name?: string | null; company?: string | null },
): boolean {
  const left = [a.name, a.company].map((v) => stripNoise(normalizeName(v))).filter(Boolean);
  const right = [b.name, b.company].map((v) => stripNoise(normalizeName(v))).filter(Boolean);

  for (const x of left) {
    for (const y of right) {
      if (x === y) return true;
      const [short, long] = x.length <= y.length ? [x, y] : [y, x];
      if (short.length >= MIN_CONTAINED_LENGTH && long.includes(short)) return true;
    }
  }
  return false;
}

interface LeadRow {
  id: string;
  name: string | null;
  company: string | null;
  normalized_phone: string | null;
  segment: string | null;
  uf: string | null;
  erp_code: string | null;
  origin: string | null;
}

/**
 * Para cada cliente a criar, o lead existente que ele deve adotar.
 *
 * Chave do resultado: `externalId` do cliente. Um lead é adotado por UM cliente
 * só — `upsell_clients` é UNIQUE em (org, lead_id), e dois clientes do ERP com o
 * mesmo telefone e nome parecido não podem disputar o mesmo lead.
 */
export async function findAdoptableLeads(
  admin: SupabaseClient,
  params: {
    organizationId: string;
    clients: CanonicalClient[];
    normalizePhone: (phone: string | null) => string | null;
  },
): Promise<Map<string, AdoptableLead>> {
  const { organizationId, clients, normalizePhone } = params;
  const adopted = new Map<string, AdoptableLead>();

  const byPhone = new Map<string, CanonicalClient[]>();
  for (const client of clients) {
    const phone = client.phone ? normalizePhone(client.phone) : null;
    if (!phone) continue;
    byPhone.set(phone, [...(byPhone.get(phone) ?? []), client]);
  }
  if (byPhone.size === 0) return adopted;

  const phones = [...byPhone.keys()];
  const taken = new Set<string>();

  for (let offset = 0; offset < phones.length; offset += 200) {
    const { data, error } = await admin
      .from("leads")
      .select("id, name, company, normalized_phone, segment, uf, erp_code, origin")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .is("erp_code", null)
      .in("normalized_phone", phones.slice(offset, offset + 200));
    if (error) throw new Error(`Falha ao buscar leads adotáveis: ${error.message}`);

    const candidates = ((data ?? []) as LeadRow[]).filter(
      (lead) => !(lead.origin ?? "").startsWith("erp_"),
    );
    if (candidates.length === 0) continue;

    // Lead que já tem cliente na carteira não é adotável.
    const { data: owned, error: ownedError } = await admin
      .from("upsell_clients")
      .select("lead_id")
      .eq("organization_id", organizationId)
      .in("lead_id", candidates.map((c) => c.id));
    if (ownedError) throw new Error(`Falha ao checar a carteira: ${ownedError.message}`);
    const withClient = new Set((owned ?? []).map((r: { lead_id: string }) => r.lead_id));

    for (const lead of candidates) {
      if (withClient.has(lead.id) || taken.has(lead.id) || !lead.normalized_phone) continue;
      const match = (byPhone.get(lead.normalized_phone) ?? []).find(
        (client) => !adopted.has(client.externalId) && sameCompanyName(client, lead),
      );
      if (!match) continue;
      taken.add(lead.id);
      adopted.set(match.externalId, {
        id: lead.id,
        hasSegment: !!lead.segment,
        hasUf: !!lead.uf,
      });
    }
  }

  return adopted;
}
