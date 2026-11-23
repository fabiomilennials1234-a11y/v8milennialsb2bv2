/**
 * Follow-ups vencidos que disparam o gatilho `followup_overdue` de UM workflow.
 *
 * A varredura periódica roda como service_role, que ignora a RLS. Sem o filtro de
 * organização, um workflow de uma org pegava follow-ups vencidos de TODAS as orgs e
 * agia sobre leads alheios (inclusive enviando WhatsApp pelo número da org dona do
 * workflow). O filtro por igualdade também exclui follow-up sem organização, que não
 * pertence a workflow nenhum.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const OVERDUE_FOLLOWUPS_PER_SWEEP = 50;

export async function overdueFollowupLeadIds(
  supabase: SupabaseClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const { data } = await supabase
    .from("follow_ups")
    .select("lead_id")
    .eq("organization_id", organizationId)
    .lt("due_date", now.toISOString())
    .is("completed_at", null)
    .limit(OVERDUE_FOLLOWUPS_PER_SWEEP);
  return ((data ?? []) as Array<{ lead_id: string | null }>)
    .map((r) => r.lead_id)
    .filter((id): id is string => !!id);
}
