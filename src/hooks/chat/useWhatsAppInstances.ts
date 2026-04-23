/**
 * useWhatsAppInstancesForUser + useActiveWhatsAppInstance
 * Extraídos de src/hooks/useWhatsAppChat.ts (C12).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember, isVirtualTeamMember } from "@/hooks/useTeamMembers";
import type { WhatsAppInstanceForUser } from "./types";

/**
 * Lista instâncias (exceto com status "error") às quais o usuário está vinculado.
 * Se a instância não tiver vendedores em whatsapp_instance_allowed_members, todos da org podem.
 * Caso contrário, só retorna instâncias em que o team_member do usuário está na lista.
 */
export function useWhatsAppInstancesForUser() {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const teamMemberId = teamMember?.id;
  const teamMemberRole = teamMember?.role;
  const isMasterVirtual = isVirtualTeamMember(teamMemberId);
  const isAdmin = teamMemberRole === "admin";

  return useQuery({
    queryKey: ["whatsapp_instances_for_user", organizationId, teamMemberId],
    queryFn: async () => {
      if (!organizationId || !teamMemberId) return [];

      const { data: instances, error: instError } = await supabase
        .from("whatsapp_instances")
        .select("id, instance_name, status")
        .eq("organization_id", organizationId)
        .neq("status", "error")
        .order("instance_name");

      if (instError) throw instError;
      if (!instances?.length) return [];

      // Master (shadow user) e admins veem todas as instâncias sem restrição
      if (isMasterVirtual || isAdmin) {
        return instances as WhatsAppInstanceForUser[];
      }

      const { data: allowedRows } = await supabase
        .from("whatsapp_instance_allowed_members")
        .select("whatsapp_instance_id")
        .in("whatsapp_instance_id", instances.map((i) => i.id));

      const instanceIdsWithRestriction = new Set(
        (allowedRows ?? []).map((r) => r.whatsapp_instance_id)
      );
      const allowedMemberByInstance: Record<string, boolean> = {};
      if (allowedRows?.length) {
        const { data: memberRows } = await supabase
          .from("whatsapp_instance_allowed_members")
          .select("whatsapp_instance_id, team_member_id")
          .in("whatsapp_instance_id", instances.map((i) => i.id))
          .eq("team_member_id", teamMemberId);
        for (const row of memberRows ?? []) {
          allowedMemberByInstance[row.whatsapp_instance_id] = true;
        }
      }

      const result: WhatsAppInstanceForUser[] = [];
      for (const inst of instances) {
        const hasRestriction = instanceIdsWithRestriction.has(inst.id);
        if (!hasRestriction) {
          result.push(inst as WhatsAppInstanceForUser);
        } else if (allowedMemberByInstance[inst.id]) {
          result.push(inst as WhatsAppInstanceForUser);
        }
      }
      return result;
    },
    enabled: !!organizationId && !!teamMemberId,
  });
}

/**
 * Hook para buscar instância ativa do WhatsApp (status "connected")
 */
export function useActiveWhatsAppInstance() {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["whatsapp_active_instance", organizationId],
    queryFn: async () => {
      if (!organizationId) return null;

      const { data, error } = await supabase
        .from("whatsapp_instances")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("status", "connected")
        .single();

      if (error) {
        if (error.code === "PGRST116") return null; // Nenhum resultado
        throw error;
      }

      return data;
    },
    enabled: !!organizationId,
  });
}
