/**
 * Hook para autenticação e verificação de permissões Master
 *
 * Verifica se o usuário atual é um Master/Dev com acesso total ao sistema.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface MasterUser {
  id: string;
  user_id: string;
  permissions: Record<string, boolean>;
  is_active: boolean;
  granted_at: string;
  notes: string | null;
}

export interface MasterPermissions {
  all?: boolean;
  organizations?: boolean;
  users?: boolean;
  billing?: boolean;
  features?: boolean;
  impersonation?: boolean;
  audit?: boolean;
}

/**
 * Hook principal para verificar se o usuário é Master
 */
export function useMasterAuth() {
  const { user } = useAuth();

  const { data: masterUser, isLoading, error } = useQuery({
    queryKey: ["master-auth", user?.id],
    queryFn: async (): Promise<MasterUser | null> => {
      if (!user?.id) return null;

      const { data, error } = await supabase
        .from("master_users")
        .select("id, user_id, permissions, is_active, granted_at, notes")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .single();

      if (error) {
        // PGRST116 = not found, which is expected for non-master users
        if (error.code === "PGRST116") return null;
        console.error("Error checking master status:", error);
        return null;
      }

      return data as MasterUser;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutos
    retry: false,
  });

  const permissions = (masterUser?.permissions || {}) as MasterPermissions;

  /**
   * Verifica se o master tem uma permissão específica
   */
  const hasPermission = (permission: keyof MasterPermissions): boolean => {
    if (!masterUser) return false;
    if (permissions.all) return true;
    return !!permissions[permission];
  };

  return {
    isMaster: !!masterUser,
    masterUser,
    permissions,
    hasPermission,
    isLoading,
    error,
  };
}

/**
 * Hook para verificar se pode acessar a área master
 */
export function useCanAccessMaster() {
  const { isMaster, isLoading } = useMasterAuth();
  return { canAccess: isMaster, isLoading };
}
