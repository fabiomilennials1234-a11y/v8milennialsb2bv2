/**
 * Hook para troca rápida de organização
 *
 * Busca todas as orgs onde o usuário tem team_member ativo.
 * Permite trocar de org invalidando o cache do React Query.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { setSelectedOrgId } from "./useTeamMembers";

export interface SwitcherOrg {
  id: string;
  name: string;
  slug: string;
  org_type: string;
  role: string;
}

export function useOrgSwitcher() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isSwitching, setIsSwitching] = useState(false);

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ["org-switcher", user?.id],
    queryFn: async (): Promise<SwitcherOrg[]> => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from("team_members")
        .select(`
          organization_id,
          role,
          organizations!inner(id, name, slug, org_type)
        `)
        .eq("user_id", user.id)
        .eq("is_active", true);

      if (error) throw error;
      if (!data) return [];

      return data.map((tm: any) => ({
        id: tm.organizations.id,
        name: tm.organizations.name,
        slug: tm.organizations.slug,
        org_type: tm.organizations.org_type,
        role: tm.role,
      }));
    },
    enabled: !!user?.id,
    staleTime: 2 * 60 * 1000, // 2 minutos
  });

  const switchOrg = async (targetOrgId: string) => {
    if (isSwitching) return;
    setIsSwitching(true);

    try {
      // Salvar a org selecionada no localStorage
      setSelectedOrgId(targetOrgId);

      // Invalidar todas as queries para forçar reload com nova org
      await queryClient.invalidateQueries();

      // Pequeno delay para garantir que o estado é limpo
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      setIsSwitching(false);
    }
  };

  return {
    orgs,
    isLoading,
    isSwitching,
    switchOrg,
    hasMultipleOrgs: orgs.length > 1,
  };
}
