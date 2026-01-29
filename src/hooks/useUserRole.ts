import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";

export type UserRole = Tables<"user_roles">;
export type AppRole = "admin" | "sdr" | "closer";

export function useUserRole() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ["user_role", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      
      const { data, error } = await supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      
      if (error) throw error;
      return data;
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
