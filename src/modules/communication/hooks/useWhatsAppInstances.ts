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

/**
 * How long a pairing QR is actually good for.
 *
 * WhatsApp rotates the pairing QR roughly every 20s and Uazapi follows it — we
 * measured the provider emitting a fresh `connection` event every ~20s for the
 * whole pairing window. The previous value here was 5 minutes, which was not a
 * shorter-than-real safety margin but a flat overstatement: the stored code was
 * already dead for most of the window it claimed to be valid, and nothing in the
 * UI ever replaced it. Every scan after the first rotation silently failed and
 * the instance eventually died with the provider reason "QR Code timeout".
 *
 * Keep this honest. It is the only written record of the code's real lifetime.
 */
const QR_CODE_TTL_MS = 20_000;

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
            ? new Date(Date.now() + QR_CODE_TTL_MS).toISOString()
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
            ? new Date(Date.now() + QR_CODE_TTL_MS).toISOString()
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

      const updates: WhatsAppInstanceUpdate = {
        status: status.connected ? "connected" : "disconnected",
      };
      // Persist the connected account's own number when the provider reports it,
      // so Settings can show which WhatsApp is live. Never clobber with null.
      if (status.connected && status.owner) {
        updates.phone_number = status.owner;
      }

      if (status.connected) {
        updates.last_connection_at = new Date().toISOString();
        // Pairing is over — drop any stored code. This is also the cleanup path
        // for codes older rows still carry: `qr_code` is world-readable inside
        // the org (see the note below), so the fewer that linger, the better.
        updates.qr_code = null;
        updates.qr_code_expires_at = null;
      }
      // Deliberately absent: `last_connection_at: null` on the disconnected
      // branch, which is what the previous version wrote on *every* poll. That
      // erased the real "last time this number was live" from any instance whose
      // reconnect modal was ever opened — three instances in prod carry a NULL
      // there today despite thousands of delivered messages, which made a live
      // number look like it had never connected in every health view we have.
      // Disconnecting is not evidence that a past connection never happened.

      const { data, error } = await supabase
        .from("whatsapp_instances")
        .update(updates)
        .eq("id", args.instance_id)
        .eq("organization_id", teamMember.organization_id)
        .select()
        .single();

      if (error) throw error;

      // THE FIX — and note where it does NOT go: the database.
      //
      // `/instance/status` already carries the provider's *current* pairing
      // code, and this mutation already polls it every 3s while the connect
      // modal is open. We were discarding that value, leaving whatever code was
      // minted at instance-creation time frozen in `whatsapp_instances.qr_code`.
      // The provider rotates the QR every ~20s, so from the first rotation
      // onward the customer was scanning a dead image with no way to tell,
      // until the session died with the provider's own reason: "QR Code
      // timeout" / "Pair Code timeout".
      //
      // Handing it back as transient data (never persisted) fixes that at zero
      // extra provider requests — the response is already in hand — and keeps
      // the blast radius where it belongs. Persisting it would have been the
      // obvious move and the wrong one: RLS on `whatsapp_instances` gates
      // INSERT/UPDATE/DELETE behind `can_manage_whatsapp_instances()` but lets
      // *every* member of the org SELECT the row. A stored, continuously
      // refreshed QR is a live pairing credential any teammate could read and
      // scan to bind the org's WhatsApp to their own handset. Today that column
      // is inert precisely because the code in it is always dead — writing a
      // fresh one every 3s would have quietly armed it.
      //
      // The pairing surface is a modal that is already polling. It has no need
      // for durable storage, so it gets none.
      return {
        ...(data as WhatsAppInstance),
        qrcode: status.qrcode,
        paircode: status.paircode,
      };
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
