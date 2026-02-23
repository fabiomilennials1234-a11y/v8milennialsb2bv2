/**
 * Hook para gerenciar permissões de sidebar do CLIENTE em orgs OUTBOUND.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

export interface SidebarPermission {
  id: string;
  organization_id: string;
  sidebar_key: string;
  is_visible: boolean;
}

export const SIDEBAR_KEY_LABELS: Record<string, string> = {
  dashboard: "Dashboard (Central de Comando)",
  campanhas: "Campanhas",
  marketing: "Marketing",
  chat_whatsapp: "Chat WhatsApp",
  funis: "Funis (Qualificação, Confirmação, Propostas, Carteira)",
  follow_ups: "Revisão / Follow-ups",
  leads: "Combustível / Leads",
  performance: "Pódio / Performance",
  comissoes: "Comissões",
  copilot: "Copilot",
  equipe: "Pilotos / Equipe",
  produtos: "Produtos",
  tv_dashboard: "TV Dashboard",
  configuracoes: "Configurações",
};

/**
 * Busca as permissões de sidebar configuradas para a org atual
 */
export function useClientSidebarPermissions() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["client-sidebar-permissions", organizationId],
    queryFn: async (): Promise<SidebarPermission[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("client_sidebar_permissions")
        .select("*")
        .eq("organization_id", organizationId);

      if (error) throw error;
      return (data ?? []) as SidebarPermission[];
    },
    enabled: isReady && !!organizationId,
    staleTime: 60 * 1000, // 1 minuto
  });
}

/**
 * Retorna um Set de sidebar_keys visíveis para o CLIENTE
 */
export function useVisibleSidebarKeys(): Set<string> {
  const { data: permissions = [] } = useClientSidebarPermissions();
  return new Set(
    permissions.filter((p) => p.is_visible).map((p) => p.sidebar_key)
  );
}

/**
 * Mutation para atualizar visibilidade de um sidebar_key (update only — uso interno)
 */
export function useUpdateClientSidebarPermission() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({
      sidebar_key,
      is_visible,
    }: {
      sidebar_key: string;
      is_visible: boolean;
    }) => {
      if (!organizationId) throw new Error("Organization not available");

      const { error } = await supabase
        .from("client_sidebar_permissions")
        .update({ is_visible })
        .eq("organization_id", organizationId)
        .eq("sidebar_key", sidebar_key);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["client-sidebar-permissions", organizationId],
      });
    },
  });
}

/**
 * Mutation com upsert — cria o registro se não existir, atualiza se já existir.
 * Usado pelo ClienteSidebarConfig para orgs que foram criadas antes do seeding completo.
 */
export function useUpsertClientSidebarPermission() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({
      sidebar_key,
      is_visible,
    }: {
      sidebar_key: string;
      is_visible: boolean;
    }) => {
      if (!organizationId) throw new Error("Organization not available");

      const { error } = await supabase
        .from("client_sidebar_permissions")
        .upsert(
          {
            organization_id: organizationId,
            sidebar_key,
            is_visible,
          },
          { onConflict: "organization_id,sidebar_key" }
        );

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["client-sidebar-permissions", organizationId],
      });
    },
  });
}
