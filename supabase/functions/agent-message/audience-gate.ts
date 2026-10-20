/**
 * Audience gate — decide se inbound de phone desconhecido deve criar lead.
 *
 * Regra: se QUALQUER agente ativo da org tem attend_unknown_contacts=false,
 * bloqueia. Flag funciona como veto org-wide (fail-closed).
 *
 * Antes (incidente Distetica 2026-05-21): filtrava is_default=true e bypassava
 * silenciosamente orgs sem agente flagged default.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveLeadByPhone } from "../_shared/lead-by-phone.ts";

export type AudienceGateResult =
  | { blocked: false }
  | { blocked: true; agentId: string };

export async function checkAudienceGate(
  supabase: SupabaseClient,
  organizationId: string,
  normalizedPhone: string,
): Promise<AudienceGateResult> {
  // Contato que já é lead nunca é "desconhecido", mesmo quando o número
  // pertence a 2+ leads (Chamados 99067f13, 33c5fd52): ali o resolvedor devolve
  // leadId null, mas `candidateIds` prova que o número tem lead. O `.maybeSingle()`
  // antigo errava com 2 linhas, virava "sem lead" e podia bloquear quem é lead.
  const { candidateIds } = await resolveLeadByPhone(supabase, organizationId, normalizedPhone);
  if (candidateIds.length > 0) return { blocked: false };

  const { data: blockingAgent } = await supabase
    .from("copilot_agents")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .eq("attend_unknown_contacts", false)
    .limit(1)
    .maybeSingle();

  if (blockingAgent) return { blocked: true, agentId: blockingAgent.id };
  return { blocked: false };
}
