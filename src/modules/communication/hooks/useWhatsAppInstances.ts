import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import {
  createWhatsAppInstance as proxyCreateInstance,
  connectInstanceQR as proxyConnectQR,
  getInstanceStatus as proxyGetStatus,
  deleteWhatsAppInstance as proxyDeleteInstance,
  logoutWhatsAppInstance as proxyLogoutInstance,
} from "@/modules/communication/lib/whatsappApi";

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

/**
 * Creates a WhatsApp instance via whatsapp-api-proxy (provider-agnostic).
 * Proxy inserts the row, creates the provider-side instance, and returns
 * initial status (which may already include qrcode/paircode).
 */
export function useCreateWhatsAppInstance() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async (data: { instance_name: string }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Usuário não está vinculado a uma organização");
      }

      const { instance_id, result } = await proxyCreateInstance(
        data.instance_name,
        teamMember.organization_id
      );

      // Persist qrcode/paircode in local row so UI can read from query cache
      await supabase
        .from("whatsapp_instances")
        .update({
          qr_code: result.status.qrcode ?? null,
          qr_code_expires_at: result.status.qrcode
            ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
            : null,
        })
        .eq("id", instance_id);

      const { data: instance, error } = await supabase
        .from("whatsapp_instances")
        .select("*")
        .eq("id", instance_id)
        .single();

      if (error) throw error;
      return { ...(instance as WhatsAppInstance), paircode: result.status.paircode };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
    },
  });
}

export function useUpdateWhatsAppInstance() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({ id, ...updates }: WhatsAppInstanceUpdate & { id: string }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Usuário não está vinculado a uma organização");
      }
      const { data, error } = await supabase
        .from("whatsapp_instances")
        .update(updates)
        .eq("id", id)
        .eq("organization_id", teamMember.organization_id)
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

/**
 * Re-fetches QR code / pair code for an existing instance via proxy.
 * Returns both — UI may show either depending on provider + user input.
 */
export function useRefreshQRCode() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async (args: { instance_id: string; phone?: string }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Usuário não está vinculado a uma organização");
      }
      const { qrcode, paircode } = await proxyConnectQR(
        args.instance_id,
        args.phone,
        teamMember.organization_id
      );

      const { data, error } = await supabase
        .from("whatsapp_instances")
        .update({
          qr_code: qrcode ?? null,
          qr_code_expires_at: qrcode
            ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
            : null,
          status: "connecting",
        })
        .eq("id", args.instance_id)
        .eq("organization_id", teamMember.organization_id)
        .select()
        .single();

      if (error) throw error;
      return { instance: data as WhatsAppInstance, paircode };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
    },
  });
}

export function useCheckConnectionStatus() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async (args: { instance_id: string }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Usuário não está vinculado a uma organização");
      }
      const status = await proxyGetStatus(args.instance_id, teamMember.organization_id);

      const { data, error } = await supabase
        .from("whatsapp_instances")
        .update({
          status: status.connected ? "connected" : "disconnected",
          last_connection_at: status.connected ? new Date().toISOString() : null,
        })
        .eq("id", args.instance_id)
        .eq("organization_id", teamMember.organization_id)
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
  removedFromProvider: boolean;
  providerError?: string;
};

export function useDeleteWhatsAppInstance() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      id,
    }: {
      id: string;
      instance_name?: string; // kept for back-compat; not used
    }): Promise<DeleteInstanceResult> => {
      if (!teamMember?.organization_id) {
        throw new Error("Usuário não está vinculado a uma organização");
      }

      await proxyDeleteInstance(id, teamMember.organization_id);
      return { removedFromProvider: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
    },
  });
}

export function useLogoutInstance() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async (args: { instance_id: string }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Usuário não está vinculado a uma organização");
      }
      await proxyLogoutInstance(args.instance_id, teamMember.organization_id);

      const { data, error } = await supabase
        .from("whatsapp_instances")
        .update({
          status: "disconnected",
          qr_code: null,
          qr_code_expires_at: null,
        })
        .eq("id", args.instance_id)
        .eq("organization_id", teamMember.organization_id)
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
