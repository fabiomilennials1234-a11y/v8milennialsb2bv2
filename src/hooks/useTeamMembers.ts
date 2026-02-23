import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useOrganization } from "./useOrganization";
import { useRealtimeSubscription } from "./useRealtimeSubscription";

export type TeamMember = Tables<"team_members">;
export type TeamMemberInsert = TablesInsert<"team_members">;
export type TeamMemberUpdate = TablesUpdate<"team_members">;

// Chave no localStorage para org selecionada (org switcher)
const SELECTED_ORG_KEY = "selected_org_id";

export function getSelectedOrgId(): string | null {
  try {
    return localStorage.getItem(SELECTED_ORG_KEY);
  } catch {
    return null;
  }
}

export function setSelectedOrgId(orgId: string) {
  try {
    localStorage.setItem(SELECTED_ORG_KEY, orgId);
  } catch {
    // localStorage indisponível
  }
}

// Hook to get the current user's team member record
// Suporta troca de org via localStorage (org switcher)
export function useCurrentTeamMember() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["team_members", "current", user?.id],
    queryFn: async () => {
      if (!user?.id) {
        console.log("🔍 useCurrentTeamMember: Sem user.id");
        return null;
      }

      console.log("🔍 useCurrentTeamMember: Buscando team_member para user:", user.id);

      const storedOrgId = getSelectedOrgId();

      // Se tem org selecionada, buscar team_member dessa org
      if (storedOrgId) {
        const { data } = await supabase
          .from("team_members")
          .select("*")
          .eq("user_id", user.id)
          .eq("organization_id", storedOrgId)
          .eq("is_active", true)
          .maybeSingle();

        if (data) {
          console.log("✅ useCurrentTeamMember: Resultado (org selecionada):", {
            organizationId: data.organization_id,
          });
          return data as TeamMember;
        }
        // Se não encontrou nessa org, fallback abaixo
      }

      // Fallback: buscar qualquer team_member ativo do user
      const { data, error } = await supabase
        .from("team_members")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("❌ useCurrentTeamMember: Erro ao buscar:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          fullError: error,
        });
        throw error;
      }

      // Salvar a org encontrada como preferência
      if (data?.organization_id) {
        setSelectedOrgId(data.organization_id);
      }

      console.log("✅ useCurrentTeamMember: Resultado:", {
        hasData: !!data,
        organizationId: data?.organization_id,
      });

      return data as TeamMember | null;
    },
    enabled: !!user?.id,
    retry: 2,
    staleTime: 30000, // 30 segundos
  });
}

/**
 * Lista membros da equipe da organização atual.
 * SECURITY: Filtra por organization_id para isolamento entre organizações.
 */
export function useTeamMembers() {
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("team_members", ["team_members", "tv-dashboard"]);

  return useQuery({
    queryKey: ["team_members", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("team_members")
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

      return data as TeamMember[];
    },
    enabled: isReady && !!organizationId,
    retry: 1,
  });
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

      const { data, error } = await query.select().single();

      if (error) throw error;
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
