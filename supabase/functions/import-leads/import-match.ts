/**
 * Quem já está na organização com o telefone (ou o email) de cada linha da planilha,
 * e o que a planilha pode mudar nesse cadastro.
 *
 * Casamento pelo telefone NORMALIZADO — `normalize_brazilian_phone`, a mesma chave do
 * índice único `idx_leads_org_phone_unique` —, no telefone principal (`leads`) e nos
 * extras (`lead_phones`). O pré-check antigo procurava a string exata "55"+DDD+número:
 * na Café Jurerê 83% dos leads guardam o formato do ERP (sem o 55), o import não os
 * achava, tentava criar e tomava 23505 com a mensagem crua do banco na tela (25/11/2026).
 *
 * Duas regras de escrita valem para todas as orgs:
 *  - cliente do ERP (`erp_code`) é somente leitura: a planilha não troca nome, telefone,
 *    campo personalizado nem nota de quem o ERP mantém;
 *  - lead existente só COMPLETA o que está vazio. O "valor mais longo vence" de antes
 *    trocava a razão social do ERP pelo nome do Google Maps.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeBrazilianPhone } from "../_shared/erp/phone.ts";
import { tothSituacao, tothSituacaoLabel } from "../_shared/erp/toth-situacao.ts";

/** Colunas do lead que o import lê para decidir e completar. */
export const EXISTING_LEAD_COLUMNS =
  "id, phone, normalized_phone, phone_compartilhado, erp_code, name, company, email, faturamento, segment, notes, rating, utm_campaign, utm_source, utm_medium, utm_content, utm_term, created_at";

export interface ExistingLead {
  id: string;
  phone: string | null;
  normalized_phone: string | null;
  phone_compartilhado: boolean | null;
  erp_code: string | null;
  name: string | null;
  company: string | null;
  email: string | null;
  faturamento: string | null;
  segment: string | null;
  notes: string | null;
  rating: number | null;
  utm_campaign: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_content: string | null;
  utm_term: string | null;
  created_at: string | null;
  /**
   * Situação do cliente no ERP (código cru do Toth: "0" ativo, "1" inativo…). Não é
   * coluna de `leads`: `findExistingLeads` lê de `upsell_clients` pelo código.
   * `null` = consultado, o ERP não informou; ausente = não deu para consultar.
   */
  erp_situacao?: string | null;
}

export interface ExistingLeads {
  /** Telefone normalizado → o DONO do número na org. */
  byPhone: Map<string, ExistingLead>;
  /** Email minúsculo → lead (só para linhas sem telefone). */
  byEmail: Map<string, ExistingLead>;
}

/**
 * Números por requisição. `in.(…)` vai na URL do PostgREST, e a resposta tem teto de
 * 1000 linhas: com 150 números sobra folga para os compartilhados.
 */
const PHONES_PER_REQUEST = 150;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Entre leads com o mesmo número, o dono é o NÃO compartilhado mais antigo — a mesma
 * ordem de `api_create_lead` (`ORDER BY phone_compartilhado, created_at, id`).
 */
function isBetterOwner(candidate: ExistingLead, current: ExistingLead): boolean {
  const a = candidate.phone_compartilhado ? 1 : 0;
  const b = current.phone_compartilhado ? 1 : 0;
  if (a !== b) return a < b;
  const ca = candidate.created_at ?? "";
  const cb = current.created_at ?? "";
  if (ca !== cb) return ca < cb;
  return candidate.id < current.id;
}

function keepOwner(map: Map<string, ExistingLead>, key: string, lead: ExistingLead): void {
  const current = map.get(key);
  if (!current || isBetterOwner(lead, current)) map.set(key, lead);
}

/** Telefone da linha na chave do índice único; `null` quando não há número. */
export function phoneKey(phone: string | null | undefined): string | null {
  return normalizeBrazilianPhone(phone);
}

/**
 * Leads vivos da org que já têm o telefone (principal ou extra) ou o email das linhas.
 * Erro de leitura derruba a importação ANTES de gravar: seguir sem saber quem existe
 * criaria duplicata ou tomaria 23505 linha a linha.
 */
export async function findExistingLeads(
  db: SupabaseClient,
  organizationId: string,
  phones: (string | null | undefined)[],
  emails: (string | null | undefined)[],
): Promise<ExistingLeads> {
  const byPhone = new Map<string, ExistingLead>();
  const byEmail = new Map<string, ExistingLead>();

  const keys = [...new Set(phones.map(phoneKey).filter((k): k is string => !!k))];
  for (const part of chunks(keys, PHONES_PER_REQUEST)) {
    const { data, error } = await db
      .from("leads")
      .select(EXISTING_LEAD_COLUMNS)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .in("normalized_phone", part);
    if (error) throw new Error(`Falha ao procurar leads pelo telefone: ${error.message}`);
    for (const lead of (data ?? []) as ExistingLead[]) {
      if (lead.normalized_phone) keepOwner(byPhone, lead.normalized_phone, lead);
    }

    // Número que não é principal de ninguém pode ser o extra de alguém (ERP traz vários).
    const missing = part.filter((k) => !byPhone.has(k));
    if (missing.length === 0) continue;
    const { data: extras, error: extrasError } = await db
      .from("lead_phones")
      .select("lead_id, normalized_phone")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .in("normalized_phone", missing);
    if (extrasError) throw new Error(`Falha ao procurar telefones extras: ${extrasError.message}`);
    const extraRows = (extras ?? []) as { lead_id: string; normalized_phone: string | null }[];
    const leadIds = [...new Set(extraRows.map((r) => r.lead_id))];
    if (leadIds.length === 0) continue;

    const { data: owners, error: ownersError } = await db
      .from("leads")
      .select(EXISTING_LEAD_COLUMNS)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .in("id", leadIds);
    if (ownersError) throw new Error(`Falha ao ler os leads dos telefones extras: ${ownersError.message}`);
    const ownerById = new Map(((owners ?? []) as ExistingLead[]).map((l) => [l.id, l]));
    for (const row of extraRows) {
      const lead = ownerById.get(row.lead_id);
      if (lead && row.normalized_phone) keepOwner(byPhone, row.normalized_phone, lead);
    }
  }

  const mailKeys = [...new Set(
    emails.map((e) => (e ?? "").toLowerCase().trim()).filter((e) => e.includes("@")),
  )];
  for (const part of chunks(mailKeys, PHONES_PER_REQUEST)) {
    const { data, error } = await db
      .from("leads")
      .select(EXISTING_LEAD_COLUMNS)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .in("email", part);
    if (error) throw new Error(`Falha ao procurar leads pelo email: ${error.message}`);
    for (const lead of (data ?? []) as ExistingLead[]) {
      const key = lead.email?.toLowerCase().trim();
      if (key && !byEmail.has(key)) byEmail.set(key, lead);
    }
  }

  await attachErpSituations(db, organizationId, [...new Set([...byPhone.values(), ...byEmail.values()])]);
  return { byPhone, byEmail };
}

/**
 * Situação no ERP de cada cliente casado, para o relatório dizer "Inativo" em vez de só
 * "já é cliente". Pelo código (`upsell_clients.external_id`), não por `lead_id`: em
 * 26/11/2026 todo `erp_code` vivo da Café Jurerê tinha cliente pelo código, e 59 não
 * tinham pelo `lead_id`.
 *
 * Só explica a linha — não decide nada. Erro de leitura deixa a situação em branco
 * em vez de derrubar a importação.
 */
export async function attachErpSituations(
  db: SupabaseClient,
  organizationId: string,
  leads: Pick<ExistingLead, "erp_code" | "erp_situacao">[],
): Promise<void> {
  const byCode = new Map<string, Pick<ExistingLead, "erp_code" | "erp_situacao">[]>();
  for (const lead of leads) {
    const code = lead.erp_code?.trim();
    if (!code) continue;
    byCode.set(code, [...(byCode.get(code) ?? []), lead]);
  }

  for (const part of chunks([...byCode.keys()], PHONES_PER_REQUEST)) {
    const { data, error } = await db
      .from("upsell_clients")
      .select(
        "external_id, erp_status, situacao_cadastro:erp_metadata->cadastro->>situacaoParceiro, situacao_metadata:erp_metadata->>situacaoParceiro",
      )
      .eq("organization_id", organizationId)
      .eq("external_source", "toth")
      .in("external_id", part);
    if (error) {
      console.warn("[import-leads] situação do ERP indisponível:", error.message);
      return;
    }
    for (const code of part) for (const lead of byCode.get(code) ?? []) lead.erp_situacao = null;
    for (const c of (data ?? []) as ErpClientSituationRow[]) {
      const situacao = tothSituacao(c.situacao_cadastro, c.situacao_metadata, c.erp_status);
      for (const lead of byCode.get(c.external_id) ?? []) lead.erp_situacao = situacao;
    }
  }
}

interface ErpClientSituationRow {
  external_id: string;
  erp_status: string | null;
  situacao_cadastro: string | null;
  situacao_metadata: string | null;
}

/** Lead mantido pelo ERP: a planilha não escreve nele. */
export function isErpClient(lead: Pick<ExistingLead, "erp_code">): boolean {
  return !!lead.erp_code?.trim();
}

/** Vazio ou marcador de "sem informação" — o que a planilha pode preencher. */
export function isEmptyLike(v: string | null | undefined): boolean {
  if (!v) return true;
  const t = v.trim();
  if (!t) return true;
  return /^(?:-+|n\/a|na|nao informado|não informado|sem info|sem informação|0)$/i.test(t);
}

/** Valores da linha já no formato de gravação (faturamento normalizado pelo chamador). */
export interface IncomingLeadFields {
  name?: string;
  company?: string;
  email?: string;
  faturamento?: string;
  segment?: string;
  rating?: number;
  utm_campaign?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_content?: string;
  utm_term?: string;
}

const FILLABLE_TEXT = [
  "name",
  "company",
  "faturamento",
  "segment",
  "utm_campaign",
  "utm_source",
  "utm_medium",
  "utm_content",
  "utm_term",
] as const;

/**
 * O que a linha completa no lead que já existe. Só campo vazio; nunca o telefone
 * (o casamento foi por ele) e nada em cliente do ERP.
 */
export function fieldsToFill(existing: ExistingLead, incoming: IncomingLeadFields): Record<string, unknown> {
  if (isErpClient(existing)) return {};
  const out: Record<string, unknown> = {};
  for (const field of FILLABLE_TEXT) {
    const value = incoming[field]?.trim();
    if (value && isEmptyLike(existing[field])) out[field] = value;
  }
  // Email "inválido" gravado (sem @) também conta como vazio.
  const email = incoming.email?.trim();
  if (email?.includes("@") && (isEmptyLike(existing.email) || !existing.email!.includes("@"))) {
    out.email = email;
  }
  if (incoming.rating && incoming.rating > 0 && !existing.rating) out.rating = incoming.rating;
  return out;
}

/** Motivo do relatório para a linha que casou com cliente do ERP. */
export function erpClientReason(
  lead: Pick<ExistingLead, "erp_code" | "company" | "name" | "erp_situacao">,
): string {
  const who = lead.company?.trim() || lead.name?.trim() || "sem nome";
  const situacao = lead.erp_situacao === null ? "não informada" : tothSituacaoLabel(lead.erp_situacao);
  const status = situacao ? ` Situação no ERP: ${situacao}.` : "";
  return `Já é cliente do ERP — cód ${lead.erp_code!.trim()}, ${who}.${status} O cadastro do ERP não é alterado pela planilha.`;
}
