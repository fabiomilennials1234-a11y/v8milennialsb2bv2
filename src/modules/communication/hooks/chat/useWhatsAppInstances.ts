/**
 * useWhatsAppInstancesForUser + useActiveWhatsAppInstance
 * Extraídos de src/hooks/useWhatsAppChat.ts (C12).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember, isVirtualTeamMember } from "@/modules/identity";
import type { WhatsAppInstanceForUser } from "./types";

/** Quem pede a lista: o vínculo atual (`useCurrentTeamMember`). */
export interface DonoDaListaDeCaixas {
  organizationId: string | null | undefined;
  teamMemberId: string | null | undefined;
  teamMemberRole: string | null | undefined;
}

/**
 * Chave da lista de caixas do usuário — a MESMA da tela e do aquecimento do
 * boot (`src/core/boot-prewarm.ts`). Não mude o formato sem mudar os dois.
 */
export const whatsappInstancesForUserKey = ({ organizationId, teamMemberId, teamMemberRole }: DonoDaListaDeCaixas) =>
  ["whatsapp_instances_for_user", organizationId, teamMemberId, teamMemberRole] as const;

/**
 * Lista instâncias (exceto com status "error") às quais o usuário está vinculado.
 * Membros só veem números explicitamente vinculados ao seu team_member.
 * Sem vínculo, o número fica disponível apenas para gestão (admin/master).
 * Leitura sob RLS: quem decide o que volta é o banco, não o chamador.
 */
export async function buscarCaixasDoUsuario({
  organizationId,
  teamMemberId,
  teamMemberRole,
}: DonoDaListaDeCaixas): Promise<WhatsAppInstanceForUser[]> {
  if (!organizationId || !teamMemberId) return [];

  const { data: instances, error: instError } = await supabase
    .from("whatsapp_instances")
    .select("id, instance_name, status, provider, phone_number")
    .eq("organization_id", organizationId)
    .neq("status", "error")
    .order("instance_name");

  if (instError) throw instError;
  if (!instances?.length) return [];

  // Master (shadow user) e admins veem todas as instâncias sem restrição
  if (isVirtualTeamMember(teamMemberId) || teamMemberRole === "admin") {
    return instances as WhatsAppInstanceForUser[];
  }

  const { data: memberRows, error: memberError } = await supabase
    .from("whatsapp_instance_allowed_members")
    .select("whatsapp_instance_id")
    .in("whatsapp_instance_id", instances.map((i) => i.id))
    .eq("team_member_id", teamMemberId);
  if (memberError) throw memberError;
  const linkedIds = new Set((memberRows ?? []).map((r) => r.whatsapp_instance_id));
  return instances.filter((instance) => linkedIds.has(instance.id)) as WhatsAppInstanceForUser[];
}

/**
 * Lista de caixas do usuário atual (ver `buscarCaixasDoUsuario`).
 *
 * `options.enabled` existe para quem monta este hook FORA das rotas e não sabe
 * de antemão se vai precisar da lista — hoje só o `VoiceCallProvider`, que vive
 * na raiz do app e pagaria de 1 a 3 requisições em toda página, para todo
 * usuário, numa feature que está inerte em quase toda a base. Quem já sabe que
 * precisa da lista não passa nada: o padrão continua sendo ligado.
 */
export function useWhatsAppInstancesForUser(options?: { enabled?: boolean }) {
  const { data: teamMember } = useCurrentTeamMember();
  const dono: DonoDaListaDeCaixas = {
    organizationId: teamMember?.organization_id,
    teamMemberId: teamMember?.id,
    teamMemberRole: teamMember?.role,
  };

  return useQuery({
    queryKey: whatsappInstancesForUserKey(dono),
    queryFn: () => buscarCaixasDoUsuario(dono),
    enabled: (options?.enabled ?? true) && !!dono.organizationId && !!dono.teamMemberId,
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
