/**
 * Hook for accessing current user's organization context
 *
 * SECURITY: This hook provides the organization_id that should be used
 * to filter all data queries. Never bypass this filter.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "./useTeamMembers";
export type OrgType = "crm" | "outbound";
export interface OrganizationContext {
  organizationId: string | null;
  teamMemberId: string | null;
  role: string | null;
  orgType: OrgType | null;
  isLoading: boolean;
  isReady: boolean;
  error: Error | null;
}
/**
 * Returns the current user's organization context
 * Use this to get the organization_id for filtering queries
 */
export function useOrganization(): OrganizationContext {
  const { data: teamMember, isLoading: teamLoading, error: teamError } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;
  const { data: orgData, isLoading: orgLoading } = useQuery({
    queryKey: ["organization-type", orgId],
    queryFn: async () => {
      if (!orgId) return null;
      const { data, error } = await supabase
        .from("organizations")
        .select("org_type")
        .eq("id", orgId)
        .single();
      if (error) throw error;
      return data as { org_type: OrgType } | null;
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000, // 5 minutos — org_type não muda
  });
  // isLoading reflecte o carregamento completo (usado por componentes que querem esperar orgType)
  const isLoading = teamLoading || (!!orgId && orgLoading);
  // isReady habilita queries de dados assim que o orgId é conhecido.
  // NÃO aguarda orgLoading: a query org-type é metadado de UI opcional e pode falhar/retransmitir
  // sem bloquear o carregamento dos dados do pipe. Aguardar orgLoading causava loading infinito —
  // durante retries da query org-type, isReady oscilava true→false→true, fazendo as queries
  // downstream serem habilitadas e desabilitadas repetidamente sem completar.
  const isReady = !teamLoading && !!orgId;
  return {
    organizationId: orgId ?? null,
    teamMemberId: teamMember?.id ?? null,
    role: teamMember?.role ?? null,
    orgType: orgData?.org_type ?? null,
    isLoading,
    isReady,
    error: teamError as Error | null,
  };
}
/**
 * Helper to ensure organization_id is present
 * Throws if organization is not available
 */
export function useRequiredOrganization(): Required<Pick<OrganizationContext, 'organizationId' | 'teamMemberId'>> & Omit<OrganizationContext, 'organizationId' | 'teamMemberId'> {
  const context = useOrganization();
  if (!context.isLoading && !context.organizationId) {
    throw new Error("Organization context is required but not available");
  }
  return context as Required<Pick<OrganizationContext, 'organizationId' | 'teamMemberId'>> & Omit<OrganizationContext, 'organizationId' | 'teamMemberId'>;
}