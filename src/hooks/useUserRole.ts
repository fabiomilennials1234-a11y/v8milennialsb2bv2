import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import type { Tables } from "@/integrations/supabase/types";

export type UserRole = Tables<"user_roles">;
export type AppRole = "admin" | "sdr" | "closer";

export function useUserRole() {
  const { user } = useAuth();
  const { data: currentTeamMember } = useCurrentTeamMember();

  return useQuery({
    queryKey: ["user_role", user?.id, currentTeamMember?.role],
    queryFn: async () => {
      if (!user?.id) return null;
      
      const { data, error } = await supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      
      if (error) throw error;
      // Fallback: se user_roles não tem linha, usa a role do team_member da org atual (admin/closer/sdr)
      if (data) return data;
      if (currentTeamMember?.role) {
        return { user_id: user.id, role: currentTeamMember.role } as UserRole;
      }
      return null;
    },
    enabled: !!user?.id,
  });
}

export function useIsAdmin() {
  const { data: userRole, isLoading } = useUserRole();
  return {
    isAdmin: userRole?.role === "admin",
    isLoading,
  };
}

export function useHasRole(role: AppRole) {
  const { data: userRole, isLoading } = useUserRole();
  return {
    hasRole: userRole?.role === role,
    isLoading,
  };
}

/** Admin e Closers podem criar copilots, configurar agentes e gerenciar instâncias WhatsApp. Usa user_roles com fallback para team_members.role. */
export function useCanManageCopilot() {
  const { data: userRole, isLoading } = useUserRole();
  const { data: currentTeamMember, isLoading: loadingTeam } = useCurrentTeamMember();
  const role = userRole?.role ?? currentTeamMember?.role;
  return {
    canManage: role === "admin" || role === "closer",
    isLoading: isLoading || loadingTeam,
  };
}

/** Admin e Closers podem criar instâncias WhatsApp, conectar números e gerenciar vendedores por número. Usa user_roles com fallback para team_members.role. */
export function useCanManageWhatsApp() {
  const { data: userRole, isLoading } = useUserRole();
  const { data: currentTeamMember, isLoading: loadingTeam } = useCurrentTeamMember();
  const role = userRole?.role ?? currentTeamMember?.role;
  return {
    canManage: role === "admin" || role === "closer",
    isLoading: isLoading || loadingTeam,
  };
}
