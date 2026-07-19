/**
 * Hook para troca rápida de organização
 *
 * Busca todas as orgs onde o usuário tem team_member ativo.
 * Master users veem TODAS as organizações (shadow user).
 * Permite trocar de org invalidando o cache do React Query.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "../../auth/contexts/AuthContext";
import { useMasterAuth } from "../../master/hooks/useMasterAuth";
import { useGestor } from "../../gestor/hooks/useGestor";
import { setSelectedOrgId } from "./useCurrentTeamMember";

export interface SwitcherOrg {
  id: string;
  name: string;
  slug: string;
  org_type: string;
  role: string;
}

export function useOrgSwitcher() {
  const { user } = useAuth();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const { isGestor, isLoading: gestorLoading } = useGestor();
  const queryClient = useQueryClient();
  const [isSwitching, setIsSwitching] = useState(false);

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ["org-switcher", user?.id, isMaster, isGestor],
    queryFn: async (): Promise<SwitcherOrg[]> => {
      if (!user?.id) return [];

      // Master vê TODAS as organizações (shadow user)
      if (isMaster) {
        const { data, error } = await supabase
          .from("organizations")
          .select("id, name, slug, org_type")
          .order("name");

        if (error) throw error;
        return (data ?? []).map((org: any) => ({
          id: org.id,
          name: org.name,
          slug: org.slug,
          org_type: org.org_type,
          role: "admin",
        }));
      }

      // Gestor de Portfólio (não-master): apenas as orgs vinculadas (whitelist).
      // `gestor_organizations` ausente do types gerado → cast (ver gestor/types.ts).
      // A RLS já escopa as linhas ao próprio gestor; o join traz nome/slug da org.
      if (isGestor) {
        const { data, error } = await supabase
          .from("gestor_organizations" as any)
          .select("organization_id, organizations!inner(id, name, slug, org_type)");

        if (error) throw error;
        return ((data ?? []) as any[])
          .map((row) => ({
            id: row.organizations.id,
            name: row.organizations.name,
            slug: row.organizations.slug,
            org_type: row.organizations.org_type,
            role: "admin",
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }

      // Usuário normal: apenas orgs com team_member ativo
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
    enabled: !!user?.id && !masterLoading && !gestorLoading,
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
    hasMultipleOrgs: isMaster || orgs.length > 1,
    isGestor,
  };
}
