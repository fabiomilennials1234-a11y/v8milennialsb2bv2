/**
 * Lead dono de um NÚMERO — leitura determinística (Chamados 99067f13, 33c5fd52).
 *
 * Um número pode pertencer a 2+ leads vivos: o principal de um
 * (`leads.normalized_phone`) e o telefone secundário de outro (`lead_phones`).
 *
 * Ordem de resolução (CTO, 09/11 — corrige a regressão de 19/10). Idêntica ao
 * trigger `resolve_message_lead_id` (migration 20280102000000):
 *   1. UM lead vivo → ele.
 *   2. 2+ leads vivos:
 *      a. ESCOLHA EXPLÍCITA do usuário para (org, número)
 *         (`whatsapp_numero_lead_escolhido`), se o lead ainda é candidato;
 *      b. NEGÓCIO ABERTO (`deals.closed_at IS NULL AND deleted_at IS NULL`); com
 *         mais de um, o mais recente (`created_at`, depois `id`);
 *      c. VÍNCULO ANTERIOR: lead da mensagem vinculada mais recente do número,
 *         se ainda é candidato;
 *      d. NENHUM. Nunca "o primeiro", "o mais novo" nem "o dono" — a resposta
 *         não depende da ordem em que o banco devolve.
 *
 * Espelho da camada de borda: supabase/functions/_shared/lead-by-phone.ts.
 * Aqui `leadId` preferido é o do deep link (?lead=...); só vale se pertencer ao número.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

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

export interface NumberLeadSignals {
  /** Lead escolhido pelo usuário para o número (2a). Vale só se ainda for candidato. */
  chosenLeadId?: string | null;
  /** Negócios abertos dos candidatos (2b). */
  openDeals?: OpenDealRow[];
  /** Lead da mensagem vinculada mais recente do número (2c). Vale só se ainda for candidato. */
  lastLinkedLeadId?: string | null;
}

/** Negócio aberto mais recente entre os candidatos (2b). Independe da ordem. */
function pickByOpenDeal(candidates: Set<string>, openDeals: OpenDealRow[]): string | null {
  const winner = openDeals
    .filter((d) => candidates.has(d.lead_id))
    .reduce<OpenDealRow | null>((best, d) => {
      if (!best) return d;
      if (d.created_at !== best.created_at) return d.created_at > best.created_at ? d : best;
      return d.deal_id > best.deal_id ? d : best;
    }, null);
  return winner?.lead_id ?? null;
}

/**
 * Escolha pura do lead de um número: 1 candidato → ele; 2+ → escolha > negócio
 * aberto > vínculo anterior > nenhum. Não depende da ordem das entradas.
 */
export function pickLeadForNumber(candidateIds: string[], signals: NumberLeadSignals = {}): string | null {
  const unique = [...new Set(candidateIds)];
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];

  const candidates = new Set(unique);
  const chosen = signals.chosenLeadId ?? null;
  if (chosen && candidates.has(chosen)) return chosen;

  const byDeal = pickByOpenDeal(candidates, signals.openDeals ?? []);
  if (byDeal) return byDeal;

  const last = signals.lastLinkedLeadId ?? null;
  if (last && candidates.has(last)) return last;

  return null;
}

/** Tabela da escolha ainda não existe nesta base (front/borda antes da migration). */
function isMissingRelation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
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

  // 2+ leads vivos. a (escolha) e b (negócio aberto) em paralelo; c (vínculo
  // anterior) só se nenhum dos dois decidir. Lead→negócio = `deals.source_lead_id`
  // (mesma ligação do SQL; `pipeline_entries` cobre só parte dos negócios).
  const [choice, deals] = await Promise.all([
    supabase
      .from("whatsapp_numero_lead_escolhido")
      .select("lead_id")
      .eq("organization_id", organizationId)
      .eq("normalized_phone", normalizedPhone)
      .maybeSingle(),
    supabase
      .from("deals")
      .select("id, source_lead_id, created_at")
      .eq("organization_id", organizationId)
      .in("source_lead_id", candidateIds)
      .is("closed_at", null)
      .is("deleted_at", null),
  ]);
  if (choice.error && !isMissingRelation(choice.error)) {
    return { leadId: null, candidateIds, error: choice.error.message };
  }
  if (deals.error) return { leadId: null, candidateIds, error: deals.error.message };

  const chosenLeadId = (choice.data as { lead_id: string } | null)?.lead_id ?? null;
  const openDeals: OpenDealRow[] = ((deals.data ?? []) as Array<{ id: string; source_lead_id: string; created_at: string }>)
    .map((d) => ({ lead_id: d.source_lead_id, deal_id: d.id, created_at: d.created_at }));

  const decided = pickLeadForNumber(candidateIds, { chosenLeadId, openDeals });
  if (decided) return { leadId: decided, candidateIds };

  // Aqui (front) a leitura passa pela RLS de whatsapp_messages: quem não lê a
  // caixa do último vínculo pode ver outro resultado que o trigger. Quem decide
  // de verdade é o trigger `resolve_message_lead_id` (sem RLS); isto é exibição.
  const last = await supabase
    .from("whatsapp_messages")
    .select("lead_id")
    .eq("organization_id", organizationId)
    .eq("normalized_phone", normalizedPhone)
    .is("deleted_at", null)
    .not("lead_id", "is", null)
    .order("timestamp", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (last.error) return { leadId: null, candidateIds, error: last.error.message };

  const lastLinkedLeadId = ((last.data ?? []) as Array<{ lead_id: string | null }>)[0]?.lead_id ?? null;
  return { leadId: pickLeadForNumber(candidateIds, { chosenLeadId, openDeals, lastLinkedLeadId }), candidateIds };
}
