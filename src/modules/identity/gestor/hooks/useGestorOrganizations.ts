import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "../../auth/contexts/AuthContext";
import { useGestor } from "./useGestor";

export interface GestorOrganizationOverview {
  organization_id: string;
  name: string;
  slug: string;
  leads_last_7_days: number;
  sales_last_7_days: number;
  online_users: { user_id: string; name: string | null }[];
  measured_at: string;
}

// Ponte tipada até regenerar o schema após aplicar a migration (como gestor/types.ts).
type GestorClient = {
  rpc(name: "gestor_organization_overview"): PromiseLike<{
    data: GestorOrganizationOverview[] | null;
    error: { message: string; code: string } | null;
  }>;
};

export function useGestorOrganizations() {
  const { user } = useAuth();
  const { isGestor } = useGestor();
  return useQuery({
    queryKey: ["gestor-organizations", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as GestorClient).rpc(
        "gestor_organization_overview",
      );
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!user?.id && isGestor,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
