/**
 * useSocialLeadLink — vincular / criar / desvincular lead de uma conversa social.
 *
 * TRÊS MUTATIONS, TODAS RPC. Nenhuma delas escreve em tabela pelo PostgREST, e
 * isso não é preferência de estilo:
 *
 *  1. O vínculo mora em `lead_social_identities`, que é SELECT-only para
 *     `authenticated` — escrever de fora da RPC é impossível por construção
 *     (mesmo molde de `messaging_channels`).
 *  2. O backfill do histórico (`channel_messages.lead_id` da thread inteira) só
 *     a função `SECURITY DEFINER` consegue fazer: `authenticated` ficou com
 *     SELECT-only em `channel_messages`. Não existe versão front-only disto.
 *  3. CRIAR e VINCULAR são um ato só, no servidor. Dois vendedores na mesma
 *     conversa — ou dois cliques — criariam dois leads e um órfão, e NÃO existe
 *     unique em `leads` que pegue isso (o índice de telefone é parcial e um
 *     lead de Instagram nasce sem telefone). O único guarda de unicidade desta
 *     fatia é o índice da identidade; ele só guarda se o INSERT do lead estiver
 *     na MESMA transação do INSERT da identidade.
 *
 * QUEM CRIA É O HUMANO, NUNCA O WEBHOOK. O endpoint de entrada não tem
 * autenticidade de conteúdo (o fornecedor não assina o corpo), então criar lead
 * a partir dele seria dar a quem descobrir o secret um botão de inflar a base de
 * uma org. Estes hooks são exatamente a porta que o webhook não tem.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { chatQueryKeys } from "./shared/queryKeys";
import type { LeadDestination } from "@/modules/communication/hooks/useWhatsAppLeadIntegration";

/** Erro que a RPC levanta quando a identidade já aponta para OUTRO lead. */
export const IDENTITY_ALREADY_LINKED = "identity_already_linked";

/**
 * `identity_already_linked:<lead_id>` → o id do lead que já detém a identidade.
 * Devolve `null` para qualquer outro erro — a UI decide o que dizer, e dizer
 * "já vinculado" para um erro de permissão seria mentir sobre a causa.
 */
export function parseAlreadyLinkedLeadId(error: unknown): string | null {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  const match = message.match(/identity_already_linked:([0-9a-f-]{36})/i);
  return match ? match[1] : null;
}

export interface SocialConversationRef {
  messagingChannelId: string;
  externalUserId: string;
}

export interface CreateLeadFromSocialInput extends SocialConversationRef {
  name: string;
  /**
   * Opcional de propósito, e NUNCA `''`. `normalizePhone('')` devolve `''` e
   * `''` casa com `''` — mandar string vazia colapsaria todo contato de
   * Instagram num lead só. Sem telefone, o campo vai nulo.
   */
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  destination: LeadDestination;
  campanhaId?: string | null;
  customPipelineId?: string | null;
  customStageId?: string | null;
}

function nullIfBlank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Invalidações comuns às três mutations.
 *
 * `socialContacts` porque a lista carrega `lead_id`/`lead_name` vindos da RPC;
 * `leads` porque a criação acrescenta uma linha à base; `lead_by_id` porque é
 * dele que o painel de contexto lê a ficha recém-vinculada.
 */
function useInvalidateAfterLink(messagingChannelId: string | null) {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  return () => {
    void queryClient.invalidateQueries({
      queryKey: chatQueryKeys.socialContacts(organizationId, messagingChannelId),
    });
    void queryClient.invalidateQueries({ queryKey: ["leads"] });
    void queryClient.invalidateQueries({ queryKey: ["lead_by_id"] });
  };
}

/** Vincula a conversa a um lead que JÁ existe. */
export function useLinkSocialConversationToLead(messagingChannelId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const invalidate = useInvalidateAfterLink(messagingChannelId);

  return useMutation({
    mutationFn: async ({
      externalUserId,
      leadId,
    }: {
      externalUserId: string;
      leadId: string;
    }): Promise<string> => {
      const organizationId = teamMember?.organization_id;
      if (!organizationId) throw new Error("Usuário não está vinculado a uma organização");
      if (!messagingChannelId) throw new Error("Conversa sem canal de origem");

      // A RPC ainda não está em `src/integrations/supabase/types.ts` (arquivo
      // gerado do banco, regenerado só depois do apply). O cast é do CLIENTE; o
      // shape do retorno fica declarado aqui para que uma mudança de contrato
      // apareça como erro de tipo e não como `undefined` na tela. Mesmo
      // precedente de `useSocialContacts`.
      const { data, error } = await (supabase as any).rpc(
        "link_social_conversation_to_lead",
        {
          p_org: organizationId,
          p_channel: messagingChannelId,
          p_external_user_id: externalUserId,
          p_lead_id: leadId,
        },
      );
      if (error) throw error;
      return (data as string | null) ?? leadId;
    },
    onSuccess: invalidate,
  });
}

/** Cria o lead e vincula — um round-trip, uma transação. */
export function useCreateLeadFromSocial(messagingChannelId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const invalidate = useInvalidateAfterLink(messagingChannelId);

  return useMutation({
    mutationFn: async (input: CreateLeadFromSocialInput): Promise<string> => {
      const organizationId = teamMember?.organization_id;
      if (!organizationId) throw new Error("Usuário não está vinculado a uma organização");
      if (!messagingChannelId) throw new Error("Conversa sem canal de origem");

      const name = input.name.trim();
      if (!name) throw new Error("Nome é obrigatório");

      const { data, error } = await (supabase as any).rpc(
        "create_lead_from_social_conversation",
        {
          p_org: organizationId,
          p_channel: messagingChannelId,
          p_external_user_id: input.externalUserId,
          p_name: name,
          p_phone: nullIfBlank(input.phone),
          p_email: nullIfBlank(input.email),
          p_company: nullIfBlank(input.company),
          p_destination: input.destination,
          p_campanha_id: input.campanhaId ?? null,
          p_custom_pipeline_id: input.customPipelineId ?? null,
          p_custom_stage_id: input.customStageId ?? null,
        },
      );
      if (error) throw error;

      const leadId = data as string | null;
      if (!leadId) throw new Error("A criação não devolveu o lead");
      return leadId;
    },
    onSuccess: invalidate,
  });
}

/** Desfaz o vínculo. Correção de erro humano — não apaga o lead. */
export function useUnlinkSocialConversation(messagingChannelId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const invalidate = useInvalidateAfterLink(messagingChannelId);

  return useMutation({
    mutationFn: async ({ externalUserId }: { externalUserId: string }): Promise<void> => {
      const organizationId = teamMember?.organization_id;
      if (!organizationId) throw new Error("Usuário não está vinculado a uma organização");
      if (!messagingChannelId) throw new Error("Conversa sem canal de origem");

      const { error } = await (supabase as any).rpc(
        "unlink_social_conversation_from_lead",
        {
          p_org: organizationId,
          p_channel: messagingChannelId,
          p_external_user_id: externalUserId,
        },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
