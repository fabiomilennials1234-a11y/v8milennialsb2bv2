/**
 * `useCaixasDeQuemAtende` — quais caixas de WhatsApp pertencem a quem vai falar
 * com o lead: o próprio usuário e o responsável do lead.
 *
 * Existe porque admin e master enxergam TODAS as caixas da org
 * (`useWhatsAppInstancesForUser`) e o seletor de conversa, sem preferência
 * salva, as listava em ordem alfabética: a caixa de outra vendedora ficava no
 * topo (Chamados 52df972e / b7941f5e). O vínculo é `whatsapp_instance_allowed_members`.
 *
 * Duas leituras baratas, só quando alguém vai decidir a caixa. Falha de leitura
 * vira lista vazia: o sinal só ordena, nunca bloqueia a abertura da conversa.
 *
 * Sem `leadId` (link do chat só com `?phone=`) devolve só as caixas do usuário.
 * `carregando` existe para quem decide SOZINHO, sem mostrar a lista (o chat
 * abrindo lead sem conversa): decidir antes da resposta é cair de volta na
 * ordem alfabética.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember, isVirtualTeamMember } from "@/modules/identity";

export interface CaixasDeQuemAtende {
  minhasInstanceIds: string[];
  doResponsavelInstanceIds: string[];
}

const VAZIO: CaixasDeQuemAtende = { minhasInstanceIds: [], doResponsavelInstanceIds: [] };

export function useCaixasDeQuemAtende(
  leadId: string | null | undefined,
  enabled: boolean,
): CaixasDeQuemAtende & { carregando: boolean } {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;
  const meuId = teamMember?.id && !isVirtualTeamMember(teamMember.id) ? teamMember.id : null;

  const query = useQuery<CaixasDeQuemAtende>({
    queryKey: ["caixas-de-quem-atende", organizationId, meuId, leadId ?? null],
    enabled: enabled && !!organizationId,
    staleTime: 60_000,
    queryFn: async () => {
      let responsavelId: string | null = null;
      if (leadId) {
        const { data: lead, error: leadError } = await supabase
          .from("leads")
          .select("responsible_id")
          .eq("id", leadId)
          .eq("organization_id", organizationId!)
          .maybeSingle();
        if (leadError) return VAZIO;
        responsavelId = lead?.responsible_id ?? null;
      }

      const membros = [meuId, responsavelId].filter((id): id is string => !!id);
      if (membros.length === 0) return VAZIO;

      const { data, error } = await supabase
        .from("whatsapp_instance_allowed_members")
        .select("whatsapp_instance_id, team_member_id")
        .in("team_member_id", membros);
      if (error) return VAZIO;

      const vinculadasA = (id: string | null) =>
        id ? (data ?? []).filter((r) => r.team_member_id === id).map((r) => r.whatsapp_instance_id) : [];
      return {
        minhasInstanceIds: vinculadasA(meuId),
        doResponsavelInstanceIds: vinculadasA(responsavelId),
      };
    },
  });

  return { ...(query.data ?? VAZIO), carregando: enabled && query.isPending };
}
