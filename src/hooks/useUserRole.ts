import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import type { Tables } from "@/integrations/supabase/types";

export type UserRole = Tables<"user_roles">;
export type AppRole = "admin" | "member";

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
        .limit(1)
        .maybeSingle();

      if (error) throw error;
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

export function useJobTitle() {
  const { data: currentTeamMember, isLoading } = useCurrentTeamMember();
  return {
    jobTitle: (currentTeamMember as any)?.job_title || "",
    isLoading,
  };
}

export function useMetricType(): { metricType: "meetings" | "sales"; isLoading: boolean } {
  const { data: currentTeamMember, isLoading } = useCurrentTeamMember();
  return {
    metricType: ((currentTeamMember as any)?.metric_type as "meetings" | "sales") || "meetings",
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

/** Admin e Master podem gerenciar copilots. Membros precisam da feature copilot.create. */
export function useCanManageCopilot() {
  const { data: userRole, isLoading } = useUserRole();
  const { data: currentTeamMember, isLoading: loadingTeam } = useCurrentTeamMember();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const { data: featurePerms } = useFeaturePermissions();
  const role = userRole?.role ?? currentTeamMember?.role;
  return {
    canManage: isMaster || role === "admin" || featurePerms?.["copilot.create"] === true,
    isLoading: isLoading || loadingTeam || masterLoading,
  };
}

/** Admin e Master podem gerenciar instâncias WhatsApp. Membros precisam da feature whatsapp.manage_instances. */
export function useCanManageWhatsApp() {
  const { data: userRole, isLoading } = useUserRole();
  const { data: currentTeamMember, isLoading: loadingTeam } = useCurrentTeamMember();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const { data: featurePerms } = useFeaturePermissions();
  const role = userRole?.role ?? currentTeamMember?.role;
  return {
    canManage: isMaster || role === "admin" || featurePerms?.["whatsapp.manage_instances"] === true,
    isLoading: isLoading || loadingTeam || masterLoading,
  };
}

// ─── Feature Permissions Hook ───────────────────────────

interface FeaturePermissionsResponse {
  features: Record<string, boolean>;
  isAdmin: boolean;
  jobTitle: string;
  metricType: "meetings" | "sales";
}

/**
 * Busca todas as feature permissions do membro logado.
 * Cache de 5 minutos. Admin retorna tudo true.
 */
export function useFeaturePermissions() {
  const { user } = useAuth();
  const { data: currentTeamMember } = useCurrentTeamMember();

  return useQuery({
    queryKey: ["feature-permissions", user?.id, currentTeamMember?.id],
    queryFn: async (): Promise<Record<string, boolean>> => {
      if (!user?.id) return {};

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return {};

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

      const res = await fetch(
        `${supabaseUrl.replace(/\/$/, "")}/functions/v1/get-member-permissions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${anonKey}`,
            "X-User-JWT": session.access_token,
          },
          body: JSON.stringify({}),
        },
      );

      if (!res.ok) return {};

      const data = (await res.json()) as FeaturePermissionsResponse;
      return data.features || {};
    },
    enabled: !!user?.id && !!currentTeamMember?.id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Verifica se o membro tem permissão para uma feature específica.
 * Admin retorna sempre true.
 */
export function useFeaturePermission(featureKey: string): { allowed: boolean; isLoading: boolean } {
  const { data: features, isLoading } = useFeaturePermissions();
  const { isAdmin } = useIsAdmin();
  const { isMaster } = useMasterAuth();

  return {
    allowed: isMaster || isAdmin || features?.[featureKey] === true,
    isLoading,
  };
}

// ─── Deprecated hooks (kept for compatibility during migration) ──

/** @deprecated Use useIsAdmin() instead — agency is now admin */
export function useIsAgency() {
  return { isAgency: false, isLoading: false };
}

/** @deprecated Use useFeaturePermission() instead */
export function useIsBDR() {
  return { isBDR: false, isLoading: false };
}

/** @deprecated Use useFeaturePermission() instead */
export function useIsCliente() {
  return { isCliente: false, isLoading: false };
}
