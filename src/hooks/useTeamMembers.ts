import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMasterAuth } from "./useMasterAuth";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useOrganization } from "./useOrganization";
import { useRealtimeSubscription } from "./useRealtimeSubscription";

export type TeamMember = Tables<"team_members">;
export type TeamMemberInsert = TablesInsert<"team_members">;
export type TeamMemberUpdate = TablesUpdate<"team_members">;

/**
 * Detecta se um teamMemberId é virtual (master shadow user).
 * IDs virtuais nunca devem ser usados em mutations com FK.
 */
export function isVirtualTeamMember(id: string | null | undefined): boolean {
  return !!id?.startsWith("master-virtual-");
}

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

/**
 * Cria um team member virtual para o master user (shadow user).
 * Não existe no banco — apenas no frontend para manter o fluxo de contexto.
 */
function buildVirtualTeamMember(userId: string, organizationId: string): TeamMember {
  return {
    id: `master-virtual-${userId}`,
    user_id: userId,
    organization_id: organizationId,
    name: "Master",
    role: "admin",
    is_active: true,
    ote_base: null,
    ote_bonus: null,
    commission_mrr_percent: null,
    commission_projeto_percent: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as TeamMember;
}

// Hook to get the current user's team member record
// Suporta troca de org via localStorage (org switcher)
// Master users recebem um team member virtual (shadow user)
export function useCurrentTeamMember() {
  const { user } = useAuth();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();

  return useQuery({
    queryKey: ["team_members", "current", user?.id, isMaster],
    queryFn: async () => {
      if (!user?.id) {
        console.log("🔍 useCurrentTeamMember: Sem user.id");
        return null;
      }

      console.log("🔍 useCurrentTeamMember: Buscando team_member para user:", user.id, { isMaster });

      const storedOrgId = getSelectedOrgId();
      console.log("🔍 useCurrentTeamMember: storedOrgId:", storedOrgId);

      // Se tem org selecionada, buscar team_member dessa org
      if (storedOrgId) {
        const { data, error: storedOrgError } = await supabase
          .from("team_members")
          .select("*")
          .eq("user_id", user.id)
          .eq("organization_id", storedOrgId)
          .eq("is_active", true)
          .maybeSingle();

        if (storedOrgError) {
          console.error("❌ useCurrentTeamMember: Erro ao buscar com org selecionada:", storedOrgError);
        }

        if (data) {
          console.log("✅ useCurrentTeamMember: Resultado (org selecionada):", {
            organizationId: data.organization_id,
          });
          return data as TeamMember;
        }

        console.log("⚠️ useCurrentTeamMember: Nenhum team_member encontrado para org selecionada:", storedOrgId);

        // Master sem team_member nessa org: criar virtual member
        if (isMaster) {
          // Verificar se a org ainda existe
          const { data: orgExists } = await supabase
            .from("organizations")
            .select("id")
            .eq("id", storedOrgId)
            .maybeSingle();

          if (orgExists) {
            console.log("✅ useCurrentTeamMember: Master virtual (org selecionada):", { organizationId: storedOrgId });
            return buildVirtualTeamMember(user.id, storedOrgId);
          }
          // Org não existe mais, limpar e buscar outra
          console.log("⚠️ useCurrentTeamMember: Org não existe mais, limpando localStorage");
          localStorage.removeItem(SELECTED_ORG_KEY);
        } else {
          // Não-master sem team_member na org selecionada: limpar e tentar fallback
          console.log("⚠️ useCurrentTeamMember: Non-master sem acesso à org selecionada, limpando localStorage");
          localStorage.removeItem(SELECTED_ORG_KEY);
        }
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

      // Se encontrou team_member real, salvar e retornar
      if (data?.organization_id) {
        setSelectedOrgId(data.organization_id);
        console.log("✅ useCurrentTeamMember: Resultado:", {
          hasData: true,
          organizationId: data.organization_id,
        });
        return data as TeamMember;
      }

      // Master sem nenhum team_member: buscar primeira org disponível
      if (isMaster) {
        const { data: firstOrg } = await supabase
          .from("organizations")
          .select("id")
          .order("name")
          .limit(1)
          .maybeSingle();

        if (firstOrg) {
          setSelectedOrgId(firstOrg.id);
          console.log("✅ useCurrentTeamMember: Master virtual (primeira org):", { organizationId: firstOrg.id });
          return buildVirtualTeamMember(user.id, firstOrg.id);
        }
      }

      console.log("✅ useCurrentTeamMember: Resultado:", {
        hasData: false,
        organizationId: null,
      });

      return null;
    },
    enabled: !!user?.id && !masterLoading,
    retry: 2,
    staleTime: 5 * 60 * 1000, // 5 minutos
  });
}

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

      return data as TeamMember[];
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
