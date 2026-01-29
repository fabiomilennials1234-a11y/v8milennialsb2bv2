import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "./useTeamMembers";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import {
  createEvolutionInstance,
  getQRCode,
  getConnectionState,
  deleteEvolutionInstance,
  logoutInstance,
} from "@/lib/evolutionApi";

export type WhatsAppInstance = Tables<"whatsapp_instances">;
export type WhatsAppInstanceInsert = TablesInsert<"whatsapp_instances">;
export type WhatsAppInstanceUpdate = TablesUpdate<"whatsapp_instances">;

export function useWhatsAppInstances() {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["whatsapp_instances", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      // Query básica que funciona mesmo sem a migração de copilot_agent_id
      const { data, error } = await supabase
        .from("whatsapp_instances")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as WhatsAppInstance[];
    },
    enabled: !!organizationId,
  });
}

/**
 * Hook para buscar instâncias com informação do agente vinculado
 * Usa após aplicar a migração 20260124200000_link_agent_to_whatsapp_instance.sql
 */
export function useWhatsAppInstancesWithAgent() {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["whatsapp_instances_with_agent", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      try {
        const { data, error } = await supabase
          .from("whatsapp_instances")
          .select("*, copilot_agent_id")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false });

        if (error) {
          // Se o campo não existir, usar query básica
          if (error.message?.includes("copilot_agent_id")) {
            const { data: basicData } = await supabase
              .from("whatsapp_instances")
              .select("*")
              .eq("organization_id", organizationId)
              .order("created_at", { ascending: false });
            return (basicData || []).map(i => ({ ...i, copilot_agent_id: null }));
          }
          throw error;
        }
        return data as (WhatsAppInstance & { copilot_agent_id?: string | null })[];
      } catch (e) {
        // Fallback para query básica
        const { data } = await supabase
          .from("whatsapp_instances")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false });
        return (data || []).map(i => ({ ...i, copilot_agent_id: null }));
      }
    },
    enabled: !!organizationId,
  });
}

export function useCreateWhatsAppInstance() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async (data: { instance_name: string }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Usuário não está vinculado a uma organização");
      }

      // Criar instância na Evolution API
      const evolutionResponse = await createEvolutionInstance(data.instance_name);

      // Salvar no Supabase
      const instanceData: WhatsAppInstanceInsert = {
        organization_id: teamMember.organization_id,
        instance_name: data.instance_name,
        instance_id: evolutionResponse.instance?.instanceName,
        status: "connecting",
        qr_code: evolutionResponse.qrcode?.base64 || evolutionResponse.qrcode?.code,
        qr_code_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutos
        metadata: evolutionResponse,
      };

      const { data: instance, error } = await supabase
        .from("whatsapp_instances")
        .insert(instanceData)
        .select()
        .single();

      if (error) throw error;
      return instance;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
    },
  });
}

export function useUpdateWhatsAppInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: WhatsAppInstanceUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("whatsapp_instances")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
    },
  });
}

export function useRefreshQRCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (instanceName: string) => {
      const qrResponse = await getQRCode(instanceName);

      // Atualizar no Supabase
      const { data, error } = await supabase
        .from("whatsapp_instances")
        .update({
          qr_code: qrResponse.base64 || qrResponse.code,
          qr_code_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          status: "connecting",
        })
        .eq("instance_name", instanceName)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
    },
  });
}

export function useCheckConnectionStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (instanceName: string) => {
      const statusResponse = await getConnectionState(instanceName);
      const isConnected = statusResponse.instance?.state === "open";

      // Atualizar status no Supabase
      const { data, error } = await supabase
        .from("whatsapp_instances")
        .update({
          status: isConnected ? "connected" : "disconnected",
          last_connection_at: isConnected ? new Date().toISOString() : null,
        })
        .eq("instance_name", instanceName)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
    },
  });
}

export type DeleteInstanceResult = {
  removedFromEvolution: boolean;
  evolutionError?: string;
};

export function useDeleteWhatsAppInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      instance_name,
    }: {
      id: string;
      instance_name: string;
    }): Promise<DeleteInstanceResult> => {
      let removedFromEvolution = false;

      // 1. Sempre tentar remover na Evolution primeiro para não sobrecarregar o servidor
      try {
        await deleteEvolutionInstance(instance_name);
        removedFromEvolution = true;
      } catch (error: any) {
        const status = error?.status;
        const is404 = status === 404;
        if (is404) {
          // Instância já não existe na Evolution (ex.: removida manualmente) — considerar sucesso
          removedFromEvolution = true;
        } else {
          console.error("Erro ao deletar da Evolution API:", error);
          // Remove do sistema mesmo assim, mas o caller pode avisar o usuário
          removedFromEvolution = false;
        }
      }

      // 2. Deletar do Supabase (sempre, para manter consistência local)
      const { error } = await supabase
        .from("whatsapp_instances")
        .delete()
        .eq("id", id);

      if (error) throw error;

      return {
        removedFromEvolution,
        evolutionError: removedFromEvolution
          ? undefined
          : "Não foi possível remover a instância na Evolution API. Remova manualmente no painel da Evolution se necessário.",
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
    },
  });
}

export function useLogoutInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (instanceName: string) => {
      await logoutInstance(instanceName);

      // Atualizar status no Supabase
      const { data, error } = await supabase
        .from("whatsapp_instances")
        .update({
          status: "disconnected",
          qr_code: null,
          qr_code_expires_at: null,
        })
        .eq("instance_name", instanceName)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
    },
  });
}
