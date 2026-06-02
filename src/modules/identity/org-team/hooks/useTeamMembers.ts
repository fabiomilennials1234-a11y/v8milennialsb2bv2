import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import type {
  TeamMember,
  TeamMemberInsert,
  TeamMemberUpdate,
} from "./useCurrentTeamMember";

// useCurrentTeamMember + helpers de seleção de org + types de team_member foram
// extraídos para ./useCurrentTeamMember para quebrar o ciclo
// useOrganization↔useTeamMembers (slice 9.4a arch-deepening). Re-exportados aqui
// para preservar a superfície pública (barrel raiz + consumers existentes).
export {
  useCurrentTeamMember,
  getSelectedOrgId,
  setSelectedOrgId,
  isVirtualTeamMember,
} from "./useCurrentTeamMember";
export type {
  TeamMember,
  TeamMemberInsert,
  TeamMemberUpdate,
} from "./useCurrentTeamMember";

/**
 * Lista membros da equipe da organização atual.
 * SECURITY: Filtra por organization_id para isolamento entre organizações.
 */
export function useTeamMembers() {
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("team_members", ["team_members"]);

  return useQuery({
    queryKey: ["team_members", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("org_visible_members" as any)
        .select("*")
        .eq("organization_id", organizationId)
        .order("name");

      if (error) {
        console.error("❌ useTeamMembers: Erro ao buscar:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          fullError: error,
        });
        throw error;
      }

      // org_visible_members is a view absent from the generated types, so the
      // builder yields SelectQueryError and can't infer the row shape — cast via
      // unknown to the known view row type (project pattern for un-typed views).
      return data as unknown as TeamMember[];
    },
    enabled: isReady && !!organizationId,
    retry: 1,
    staleTime: 5 * 60 * 1000, // 5 minutos
  });
}

/**
 * Retorna todos os membros ativos da organização — pool unificado de responsáveis.
 * Sem filtro por role/metric_type — qualquer membro ativo pode ser responsável.
 */
export function useResponsibleMembers() {
  const { data: members = [] } = useTeamMembers();
  return members.filter((m) => m.is_active);
}

/**
 * Busca um membro por ID apenas se pertencer à organização atual.
 * SECURITY: Filtra por organization_id para evitar vazamento entre organizações.
 */
export function useTeamMember(id: string) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["team_members", id, organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const { data, error } = await supabase
        .from("team_members")
        .select("*")
        .eq("id", id)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error) throw error;
      return data as TeamMember | null;
    },
    enabled: isReady && !!organizationId && !!id,
  });
}

export function useCreateTeamMember() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (member: TeamMemberInsert) => {
      const { data, error } = await supabase
        .from("team_members")
        .insert(member)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
    },
  });
}

export function useUpdateTeamMember() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, ...updates }: TeamMemberUpdate & { id: string }) => {
      let query = supabase
        .from("team_members")
        .update(updates)
        .eq("id", id);

      // Filtrar por organization_id para segurança multi-tenant
      if (organizationId) {
        query = query.eq("organization_id", organizationId);
      }

      const { data, error } = await query.select().maybeSingle();

      if (error) throw error;
      if (!data) {
        throw new Error("Não foi possível atualizar o membro. Verifique suas permissões de admin.");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
    },
  });
}

export function useDeleteTeamMember() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("team_members")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team_members"] });
    },
  });
}
