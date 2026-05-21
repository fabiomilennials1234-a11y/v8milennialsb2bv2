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

export type AudienceGateResult =
  | { blocked: false }
  | { blocked: true; agentId: string };

export async function checkAudienceGate(
  supabase: SupabaseClient,
  organizationId: string,
  normalizedPhone: string,
): Promise<AudienceGateResult> {
  const { data: existingLead } = await supabase
    .from("leads")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("normalized_phone", normalizedPhone)
    .maybeSingle();

  if (existingLead) return { blocked: false };

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
