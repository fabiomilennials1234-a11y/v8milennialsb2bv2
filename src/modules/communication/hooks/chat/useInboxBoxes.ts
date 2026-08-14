/**
 * useInboxBoxes — as CAIXAS DE ENTRADA que o usuário pode abrir.
 *
 * O seletor do inbox era "lista de instâncias de WhatsApp". Passa a ser a união
 * de `whatsapp_instances` (via `useWhatsAppInstancesForUser`, que já aplica a
 * restrição por membro) com `messaging_channels` (canais sociais do NotificaMe).
 *
 * POR QUE NÃO HÁ FEATURE FLAG AQUI. Uma org sem canal social não tem linha em
 * `messaging_channels`; a união devolve exatamente a lista de hoje, na mesma
 * ordem, e todo o caminho de WhatsApp fica intocado. Um gate explícito no front
 * seria um segundo lugar para o estado "esta org tem Instagram?" divergir do
 * banco — e o primeiro já é a própria tabela.
 *
 * WhatsApp vem PRIMEIRO na lista de propósito: é o canal de 100% do tráfego
 * atual, e o auto-select do shell escolhe a partir desta ordem.
 */
import { useMemo } from "react";
import {
  useWhatsAppInstancesForUser,
} from "@/modules/communication/hooks/chat/useWhatsAppInstances";
import { useMessagingChannels } from "@/modules/communication/hooks/useMessagingChannels";
import type { InboxBox, WhatsAppInstanceForUser } from "./types";

export interface UseInboxBoxesResult {
  boxes: InboxBox[];
  /**
   * As instâncias cruas. O deep-link `?instance=`, a preferência de número em
   * `team_members` e o resolvedor de conversa por telefone são conceitos de
   * WhatsApp e continuam falando com a lista de WhatsApp — envolvê-los em
   * `InboxBox` só faria cada um deles ter de desembrulhar de novo.
   */
  instances: WhatsAppInstanceForUser[];
  isLoading: boolean;
}

export function useInboxBoxes(): UseInboxBoxesResult {
  const { data: instances = [], isLoading: instancesLoading } =
    useWhatsAppInstancesForUser();
  const {
    data: channels = [],
    isLoading: channelsLoading,
    isError: channelsError,
  } = useMessagingChannels();

  const boxes = useMemo<InboxBox[]>(() => {
    const whatsapp: InboxBox[] = instances.map((i) => ({
      kind: "whatsapp",
      id: i.id,
      name: i.instance_name,
      status: i.status,
      provider: i.provider,
    }));
    const social: InboxBox[] = channels
      .filter((c) => c.channel_type === "instagram")
      .map((c) => ({
        kind: "instagram",
        id: c.id,
        name: c.display_name,
        status: c.status,
        handle: c.handle,
      }));
    return [...whatsapp, ...social];
  }, [instances, channels]);

  return {
    boxes,
    instances,
    /**
     * Espera as DUAS listas. Liberar a tela com só uma delas faria a caixa de
     * Instagram nascer depois — o seletor pisca, e um auto-select que já rodou
     * teria escolhido sem enxergar metade das opções.
     *
     * `isError` corta a espera: `messaging_channels` é tabela nova, e uma org
     * cuja migration ainda não entrou não pode ficar com o chat travado nas
     * retentativas do TanStack. Sem canal social, a caixa some — que é o
     * comportamento correto.
     */
    isLoading: instancesLoading || (channelsLoading && !channelsError),
  };
}
