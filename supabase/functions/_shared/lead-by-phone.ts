/**
 * Lead dono de um NÚMERO — leitura determinística (Chamados 99067f13, 33c5fd52).
 *
 * Um número pode pertencer a 2+ leads vivos: o principal de um
 * (`leads.normalized_phone`) e o telefone secundário de outro (`lead_phones`).
 *
 * Regra de entrada (CTO, 19/10): a mensagem chega pelo NÚMERO, sem vincular
 * lead. Se algum lead desse número tiver NEGÓCIO ABERTO
 * (`deals.closed_at IS NULL AND deals.deleted_at IS NULL`), chega por ele.
 * Com mais de um, vale o negócio mais recente (`created_at`, depois `id`).
 * Sem negócio aberto e com 2+ leads: NENHUM lead. Nunca "o primeiro", "o mais
 * novo" nem "o dono" — a resposta não depende da ordem em que o banco devolve.
 *
 * Número com UM lead vivo resolve para esse lead.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface OpenDealRow {
  lead_id: string;
  deal_id: string;
  created_at: string;
}

export interface PhoneLeadResolution {
  /** Lead que recebe a mensagem; null = ambíguo (ou nenhum lead). */
  leadId: string | null;
  /** Todos os leads vivos do número. > 1 com leadId null = ambiguidade. */
  candidateIds: string[];
  /** Falha de leitura (leadId null NÃO significa "número sem lead"). */
  error?: string;
}

/** Escolha pura: não depende da ordem de `candidateIds` nem de `openDeals`. */
export function pickLeadByOpenDeal(candidateIds: string[], openDeals: OpenDealRow[]): string | null {
  const unique = [...new Set(candidateIds)];
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];

  const candidates = new Set(unique);
  const winner = openDeals
    .filter((d) => candidates.has(d.lead_id))
    .reduce<OpenDealRow | null>((best, d) => {
      if (!best) return d;
      if (d.created_at !== best.created_at) return d.created_at > best.created_at ? d : best;
      return d.deal_id > best.deal_id ? d : best;
    }, null);
  return winner?.lead_id ?? null;
}

export async function resolveLeadByPhone(
  supabase: SupabaseClient,
  organizationId: string,
  normalizedPhone: string,
  opts: { preferredLeadId?: string | null } = {},
): Promise<PhoneLeadResolution> {
  const fail = (message: string): PhoneLeadResolution => ({ leadId: null, candidateIds: [], error: message });

  const [primary, secondary] = await Promise.all([
    supabase
      .from("leads")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("normalized_phone", normalizedPhone)
      .is("deleted_at", null),
    supabase
      .from("lead_phones")
      .select("lead_id")
      .eq("organization_id", organizationId)
      .eq("normalized_phone", normalizedPhone)
      .is("deleted_at", null),
  ]);
  if (primary.error) return fail(primary.error.message);
  if (secondary.error) return fail(secondary.error.message);

  const primaryIds: string[] = (primary.data ?? []).map((r: { id: string }) => r.id);
  const secondaryIds: string[] = (secondary.data ?? []).map((r: { lead_id: string }) => r.lead_id);

  // O telefone secundário pode apontar para lead apagado: só vivo é candidato.
  let candidateIds = [...new Set(primaryIds)];
  const extra = [...new Set(secondaryIds)].filter((id) => !candidateIds.includes(id));
  if (extra.length > 0) {
    const live = await supabase
      .from("leads")
      .select("id")
      .eq("organization_id", organizationId)
      .in("id", extra)
      .is("deleted_at", null);
    if (live.error) return fail(live.error.message);
    candidateIds = [...candidateIds, ...(live.data ?? []).map((r: { id: string }) => r.id)];
  }
  candidateIds.sort();

  const preferred = opts.preferredLeadId ?? null;
  if (preferred && candidateIds.includes(preferred)) return { leadId: preferred, candidateIds };
  if (candidateIds.length <= 1) return { leadId: candidateIds[0] ?? null, candidateIds };

  // 2+ leads vivos: o negócio aberto decide. Lead→negócio = pipeline_entries.deal_id.
  const entries = await supabase
    .from("pipeline_entries")
    .select("lead_id, deal_id")
    .eq("organization_id", organizationId)
    .in("lead_id", candidateIds)
    .not("deal_id", "is", null);
  if (entries.error) return { leadId: null, candidateIds, error: entries.error.message };

  const dealToLeads = new Map<string, Set<string>>();
  for (const e of (entries.data ?? []) as Array<{ lead_id: string; deal_id: string }>) {
    if (!dealToLeads.has(e.deal_id)) dealToLeads.set(e.deal_id, new Set());
    dealToLeads.get(e.deal_id)!.add(e.lead_id);
  }
  if (dealToLeads.size === 0) return { leadId: null, candidateIds };

  const deals = await supabase
    .from("deals")
    .select("id, created_at")
    .eq("organization_id", organizationId)
    .in("id", [...dealToLeads.keys()])
    .is("closed_at", null)
    .is("deleted_at", null);
  if (deals.error) return { leadId: null, candidateIds, error: deals.error.message };

  const openDeals: OpenDealRow[] = [];
  for (const d of (deals.data ?? []) as Array<{ id: string; created_at: string }>) {
    for (const leadId of dealToLeads.get(d.id) ?? []) {
      openDeals.push({ lead_id: leadId, deal_id: d.id, created_at: d.created_at });
    }
  }
  return { leadId: pickLeadByOpenDeal(candidateIds, openDeals), candidateIds };
}
