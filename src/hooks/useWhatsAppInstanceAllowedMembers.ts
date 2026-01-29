import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "./useTeamMembers";
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
 */
export function useAllowedMembersForInstance(whatsappInstanceId: string | null) {
  return useQuery({
    queryKey: ["whatsapp_instance_allowed_members", whatsappInstanceId],
    queryFn: async () => {
      if (!whatsappInstanceId) return [];
      const { data, error } = await supabase
        .from("whatsapp_instance_allowed_members")
        .select("id, team_member_id, created_at")
        .eq("whatsapp_instance_id", whatsappInstanceId);
      if (error) throw error;
      return data as WhatsAppInstanceAllowedMember[];
    },
    enabled: !!whatsappInstanceId,
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
 */
export function useSetAllowedMembersForInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      whatsappInstanceId,
      teamMemberIds,
    }: {
      whatsappInstanceId: string;
      teamMemberIds: string[];
    }) => {
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
