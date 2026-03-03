import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import type { Tables } from "@/integrations/supabase/types";

export type UserRole = Tables<"user_roles">;
export type AppRole = "admin" | "sdr" | "closer" | "agency" | "bdr" | "cliente";

export function useUserRole() {
  const { user } = useAuth();
  const { data: currentTeamMember } = useCurrentTeamMember();

  return useQuery({
    queryKey: ["user_role", user?.id, currentTeamMember?.role],
    queryFn: async () => {
      if (!user?.id) return null;
      
      // limit(1) pois user pode ter múltiplas roles (UNIQUE é em user_id+role)
      const { data, error } = await supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", user.id)
        .limit(1)
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
    isAdmin: userRole?.role === "admin" || userRole?.role === "agency",
    isLoading,
  };
}

export function useIsAgency() {
  const { data: userRole, isLoading } = useUserRole();
  return {
    isAgency: userRole?.role === "agency",
    isLoading,
  };
}

export function useIsBDR() {
  const { data: userRole, isLoading } = useUserRole();
  return {
    isBDR: userRole?.role === "bdr",
    isLoading,
  };
}

export function useIsCliente() {
  const { data: userRole, isLoading } = useUserRole();
  return {
    isCliente: userRole?.role === "cliente",
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

/** Admin/Agency, Closers e Master podem criar copilots, configurar agentes e gerenciar instâncias WhatsApp. Usa user_roles com fallback para team_members.role. */
export function useCanManageCopilot() {
  const { data: userRole, isLoading } = useUserRole();
  const { data: currentTeamMember, isLoading: loadingTeam } = useCurrentTeamMember();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const role = userRole?.role ?? currentTeamMember?.role;
  return {
    canManage: isMaster || role === "admin" || role === "closer" || role === "agency",
    isLoading: isLoading || loadingTeam || masterLoading,
  };
}

/** Admin/Agency, Closers e Master podem criar instâncias WhatsApp, conectar números e gerenciar vendedores por número. Usa user_roles com fallback para team_members.role. */
export function useCanManageWhatsApp() {
  const { data: userRole, isLoading } = useUserRole();
  const { data: currentTeamMember, isLoading: loadingTeam } = useCurrentTeamMember();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const role = userRole?.role ?? currentTeamMember?.role;
  return {
    canManage: isMaster || role === "admin" || role === "closer" || role === "agency",
    isLoading: isLoading || loadingTeam || masterLoading,
  };
}
