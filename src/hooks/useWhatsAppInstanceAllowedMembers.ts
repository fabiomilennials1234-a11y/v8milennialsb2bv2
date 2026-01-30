import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "./useTeamMembers";
import { useOrganization } from "./useOrganization";
import { useIsAdmin } from "./useUserRole";

export interface WhatsAppInstanceAllowedMember {
  id: string;
  whatsapp_instance_id: string;
  team_member_id: string;
  created_at: string;
}

/**
 * Lista de vendedores (team_member_id) autorizados a responder neste número.
 * Se vazio = todos da organização podem responder.
 * SECURITY: Só retorna dados se a instância pertencer à organização atual.
 */
export function useAllowedMembersForInstance(whatsappInstanceId: string | null) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["whatsapp_instance_allowed_members", whatsappInstanceId, organizationId],
    queryFn: async () => {
      if (!whatsappInstanceId || !organizationId) return [];
      const { data: instance, error: instError } = await supabase
        .from("whatsapp_instances")
        .select("id")
        .eq("id", whatsappInstanceId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (instError) throw instError;
      if (!instance) return [];
      const { data, error } = await supabase
        .from("whatsapp_instance_allowed_members")
        .select("id, team_member_id, created_at")
        .eq("whatsapp_instance_id", whatsappInstanceId);
      if (error) throw error;
      return (data ?? []) as WhatsAppInstanceAllowedMember[];
    },
    enabled: isReady && !!organizationId && !!whatsappInstanceId,
  });
}

/**
 * Retorna se o usuário atual pode responder no chat desta instância.
 * Se a instância não tiver ninguém na lista de permitidos, todos podem.
 */
export function useCanReplyOnInstance(whatsappInstanceId: string | null) {
  const { data: currentTeamMember } = useCurrentTeamMember();
  const { data: allowedList = [], isLoading } = useAllowedMembersForInstance(whatsappInstanceId);

  const canReply =
    !whatsappInstanceId ||
    !currentTeamMember
      ? false
      : allowedList.length === 0
        ? true
        : allowedList.some((a) => a.team_member_id === currentTeamMember.id);

  return { canReply, isLoading, allowedCount: allowedList.length };
}

/**
 * Retorna se pode responder usando o instance_name (busca o id da instância).
 */
export function useCanReplyOnInstanceByName(instanceName: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = teamMember?.organization_id;

  const instanceQuery = useQuery({
    queryKey: ["whatsapp_instances", orgId, instanceName],
    queryFn: async () => {
      if (!orgId || !instanceName) return null;
      const { data, error } = await supabase
        .from("whatsapp_instances")
        .select("id")
        .eq("organization_id", orgId)
        .eq("instance_name", instanceName)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!instanceName,
  });

  const instanceId = instanceQuery.data?.id ?? null;
  const { canReply, isLoading, allowedCount } = useCanReplyOnInstance(instanceId);

  return {
    canReply,
    isLoading: instanceQuery.isLoading || isLoading,
    allowedCount,
    instanceId,
  };
}

/**
 * (Admin) Define a lista de vendedores que podem responder neste número.
 * Passa array de team_member_id; substitui a lista atual.
 * SECURITY: Só permite alterar instâncias da organização atual e só aceita team_member_ids da organização.
 */
export function useSetAllowedMembersForInstance() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({
      whatsappInstanceId,
      teamMemberIds,
    }: {
      whatsappInstanceId: string;
      teamMemberIds: string[];
    }) => {
      if (!organizationId) throw new Error("Organização não disponível");

      const { data: instance, error: instError } = await supabase
        .from("whatsapp_instances")
        .select("id")
        .eq("id", whatsappInstanceId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (instError) throw instError;
      if (!instance) throw new Error("Instância de WhatsApp não encontrada ou não pertence à sua organização.");

      if (teamMemberIds.length > 0) {
        const { data: membersInOrg } = await supabase
          .from("team_members")
          .select("id")
          .eq("organization_id", organizationId)
          .in("id", teamMemberIds);
        const validIds = new Set((membersInOrg ?? []).map((m) => m.id));
        const invalid = teamMemberIds.filter((id) => !validIds.has(id));
        if (invalid.length > 0) {
          throw new Error("Só é possível atribuir membros da sua organização a esta instância.");
        }
      }

      await supabase
        .from("whatsapp_instance_allowed_members")
        .delete()
        .eq("whatsapp_instance_id", whatsappInstanceId);

      if (teamMemberIds.length > 0) {
        const { error } = await supabase.from("whatsapp_instance_allowed_members").insert(
          teamMemberIds.map((team_member_id) => ({
            whatsapp_instance_id: whatsappInstanceId,
            team_member_id,
          }))
        );
        if (error) throw error;
      }
    },
    onSuccess: (_, { whatsappInstanceId }) => {
      queryClient.invalidateQueries({
        queryKey: ["whatsapp_instance_allowed_members", whatsappInstanceId],
      });
      queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
    },
  });
}
