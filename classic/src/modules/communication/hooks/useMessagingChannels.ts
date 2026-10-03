/**
 * useMessagingChannels — canais SOCIAIS não-WhatsApp conectados pela org.
 *
 * Hoje: Instagram, via NotificaMe. Amanhã, se o CTO decidir: Facebook.
 *
 * POR QUE UMA TABELA À PARTE, E NÃO `whatsapp_instances`. A fronteira é o TIPO
 * DE CANAL, não o fornecedor. Um canal de WhatsApp do NotificaMe é um número de
 * WhatsApp e mora com os outros números; um perfil de Instagram não é número,
 * não tem telefone, não é destino de disparo em massa e não pode consumir a
 * vaga PAGA de `max_whatsapp_instances`. Guardá-lo em `whatsapp_instances` faria
 * treze superfícies de front e uns oito caminhos de edge function passarem a
 * precisar de um filtro de provider que o próximo leitor esquece de replicar.
 * Aqui o isolamento é por construção: quem lê números nunca vê este hook.
 *
 * A tabela recusa `channel_type='whatsapp'` por CHECK — é o que impede o cisma
 * de nascer por descuido.
 *
 * ESCRITA: nenhuma. A linha nasce em `notificame-channel-finish` (service_role),
 * depois do diff contra a baseline da sessão. A RLS desta tabela dá SELECT à org
 * e nega INSERT/UPDATE/DELETE a `authenticated` — este hook é leitura e ponto.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";

/** Tipos de canal social. `whatsapp` não é um deles, por CHECK no banco. */
export type MessagingChannelType = "instagram" | "facebook";

export interface MessagingChannel {
  id: string;
  channel_type: MessagingChannelType;
  /** Nome do canal no fornecedor. NUNCA carrega a palavra "WhatsApp". */
  display_name: string;
  /** @handle da conta, quando o fornecedor informa. */
  handle: string | null;
  status: "connected" | "disconnected" | "error";
  connected_at: string;
}

/**
 * A chave de cache, num lugar só.
 *
 * Ela é LOAD-BEARING e tem três donos: este hook, o catálogo de integrações (que
 * lê o mesmo estado a partir de outro contexto de org) e o
 * `invalidateQueries` do `useConnectNotificame` logo depois de um canal nascer.
 * Se as três não escreverem exatamente a mesma chave, o selo "Conectado" fica
 * mostrando o estado de antes da conexão e ninguém percebe — é o tipo de defeito
 * que só aparece com um usuário real conectando de verdade.
 */
export const messagingChannelsQueryKey = (organizationId: string | null | undefined) =>
  ["messaging_channels", organizationId] as const;

/**
 * A leitura, sem React.
 *
 * Existe separada do hook porque há DOIS consumidores que descobrem a org por
 * caminhos diferentes — este hook, via `useCurrentTeamMember`, e o catálogo de
 * integrações, via `useOrganization` — e duplicar o SELECT faria a próxima
 * coluna renomeada ser corrigida em um só deles.
 */
export async function fetchMessagingChannels(
  organizationId: string,
): Promise<MessagingChannel[]> {
  // `messaging_channels` ainda não está em `src/integrations/supabase/types.ts`
  // (o arquivo é gerado do banco e só é regenerado depois da migration ir a
  // prod). O cast é do CLIENTE, não do resultado: o shape devolvido continua
  // declarado acima, em `MessagingChannel`, para que uma coluna renomeada
  // apareça como erro de tipo no consumidor em vez de virar `undefined` na
  // tela. Precedente idêntico: `useMetaConnection.ts`, `useDispatchQueueItems.ts`.
  const { data, error } = await (supabase as any)
    .from("messaging_channels")
    .select("id, channel_type, display_name, handle, status, connected_at")
    // Redundante com a RLS de propósito: a policy é a garantia, o filtro é a
    // intenção legível. Nunca só um dos dois.
    .eq("organization_id", organizationId)
    .order("connected_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as MessagingChannel[];
}

export function useMessagingChannels({ enabled = true }: { enabled?: boolean } = {}) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: messagingChannelsQueryKey(organizationId),
    enabled: enabled && !!organizationId,
    queryFn: async (): Promise<MessagingChannel[]> => {
      if (!organizationId) return [];
      return fetchMessagingChannels(organizationId);
    },
  });
}
