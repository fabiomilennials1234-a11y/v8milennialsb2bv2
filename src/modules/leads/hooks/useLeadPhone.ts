/**
 * useLeadPhone — telefone de um lead, por id.
 *
 * Existe para o deep-link `/chat?lead=<uuid>`: três call sites da carteira
 * (`CarteiraClientPreview`, `ClienteDetailPage`, `Upsell`) navegam para o chat
 * conhecendo o lead, não o telefone. O chat abre a conversa por telefone, então
 * alguém precisa fazer a tradução.
 *
 * É o inverso de `useLeadByPhone` (telefone → lead), que o chat já usa para
 * preencher o header.
 *
 * Multi-tenant: filtra por `organization_id` explicitamente além do RLS.
 *
 * Devolve `null` quando o lead não existe, não é da org, ou não tem telefone.
 * O chamador trata os três casos igual: não há conversa a abrir.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";

export function useLeadPhone(leadId: string | null | undefined) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  return useQuery<string | null>({
    queryKey: ["lead-phone", organizationId, leadId],
    queryFn: async () => {
      if (!organizationId || !leadId) return null;

      const { data, error } = await supabase
        .from("leads")
        .select("phone")
        .eq("id", leadId)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error) throw error;
      return data?.phone ?? null;
    },
    enabled: !!organizationId && !!leadId,
    staleTime: 60_000,
  });
}
