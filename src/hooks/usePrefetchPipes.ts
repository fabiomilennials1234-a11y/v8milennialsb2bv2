import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

/**
 * Prefetch pipe data on navigation hover/open.
 * Uses queryClient.prefetchQuery — only fetches if data is stale or missing.
 */
export function usePrefetchPipes() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  const prefetch = useCallback(() => {
    if (!organizationId) return;

    // Prefetch pipe_whatsapp
    queryClient.prefetchQuery({
      queryKey: ["pipe_whatsapp", organizationId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("pipe_whatsapp")
          .select(`
            *,
            lead:leads(
              id, name, company, email, phone, rating, origin, segment, faturamento, urgency, notes, compromisso_date, ai_disabled, sdr_id, closer_id, responsible_id,
              responsible:team_members!leads_responsible_id_fkey(id, name),
              sdr:team_members!leads_sdr_id_fkey(id, name),
              closer:team_members!leads_closer_id_fkey(id, name),
              lead_tags(tag:tags(id, name, color))
            ),
            responsible:team_members!pipe_whatsapp_responsible_id_fkey(id, name),
            sdr:team_members!pipe_whatsapp_sdr_id_fkey(id, name)
          `)
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data;
      },
      staleTime: 10 * 60 * 1000,
    });

    // Prefetch pipe_confirmacao
    queryClient.prefetchQuery({
      queryKey: ["pipe_confirmacao", organizationId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("pipe_confirmacao")
          .select(`
            *,
            lead:leads(
              id, name, company, email, phone, rating, origin, segment, faturamento, urgency, ai_disabled, sdr_id, closer_id, responsible_id,
              responsible:team_members!leads_responsible_id_fkey(id, name),
              sdr:team_members!leads_sdr_id_fkey(id, name),
              closer:team_members!leads_closer_id_fkey(id, name),
              lead_tags(tag:tags(id, name, color))
            ),
            responsible:team_members!pipe_confirmacao_responsible_id_fkey(id, name),
            sdr:team_members!pipe_confirmacao_sdr_id_fkey(id, name),
            closer:team_members!pipe_confirmacao_closer_id_fkey(id, name)
          `)
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data;
      },
      staleTime: 10 * 60 * 1000,
    });

    // Prefetch pipe_propostas
    queryClient.prefetchQuery({
      queryKey: ["pipe_propostas", organizationId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("pipe_propostas")
          .select(`
            *,
            lead:leads(
              id, name, company, email, phone, rating, origin, segment, faturamento, ai_disabled, sdr_id, closer_id, responsible_id,
              responsible:team_members!leads_responsible_id_fkey(id, name),
              sdr:team_members!leads_sdr_id_fkey(id, name),
              closer:team_members!leads_closer_id_fkey(id, name),
              lead_tags(tag:tags(id, name, color))
            ),
            responsible:team_members!pipe_propostas_responsible_id_fkey(id, name),
            closer:team_members!pipe_propostas_closer_id_fkey(id, name),
            product:products(id, name, type, ticket, ticket_minimo),
            items:pipe_proposta_items(
              id, product_id, sale_value, created_at,
              product:products(id, name, type, ticket, ticket_minimo)
            )
          `)
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data;
      },
      staleTime: 10 * 60 * 1000,
    });
  }, [queryClient, organizationId]);

  return prefetch;
}
