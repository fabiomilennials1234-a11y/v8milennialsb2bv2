/**
 * `useConversasUnificadas` — a lista do `/chat` quando mais de uma caixa está
 * marcada.
 *
 * ─── DUAS CHAMADAS, NUNCA UMA POR CAIXA ─────────────────────────────────────
 *
 * As RPCs da W1 recebem um CONJUNTO de Instances e aplicam o limite sobre ele
 * (decisão D3). Uma chamada por caixa, com o limite aplicado em cada uma e a
 * ordenação feita no cliente, faria a paginação mentir: a caixa movimentada
 * gastaria a página inteira e a conversa real da caixa quieta sumiria sem sinal
 * nenhum na tela. Então são duas chamadas e só duas — uma por TABELA de origem,
 * que é a fronteira que o banco realmente impõe:
 *
 *   Chip (uazapi/evolution)    → `whatsapp_messages` → get_whatsapp_conversation_list_multi
 *   canal oficial (notificame) → `channel_messages`  → get_official_whatsapp_conversation_list_multi
 *
 * Quem separa uma da outra é `boxUsesChannelMessages`, e o discriminador dele é
 * o PROVIDER, não o `kind`: o canal oficial é `kind: "whatsapp"` (mora em
 * `whatsapp_instances`) e ainda assim recebe em `channel_messages`. Decidir pelo
 * `kind` foi o que deixou mensagem invisível no chat em 18/08.
 *
 * Instagram entrou na W5, quando `get_social_conversation_list` passou a
 * aplicar o recorte por responsável (migration `20270931000000`). Até ali ele
 * ficava fora de propósito: puxá-lo para a lista unificada teria ampliado a
 * superfície de um furo conhecido.
 *
 * ⚠️ A RPC social recebe UM canal, não um conjunto — não há `_multi` dela. São
 *    N chamadas, uma por canal marcado, e isso é barato porque é raro: medido
 *    em produção, 2 organizations têm Instagram e cada uma tem 1 canal. Se um
 *    dia alguém abrir dez, o custo aparece aqui antes de aparecer no usuário.
 *
 * ─── A CAIXA DE CADA LINHA VEM DA RESPOSTA ──────────────────────────────────
 *
 * `instance_id` é coluna do `RETURNS TABLE` das duas funções. Derivar a caixa do
 * argumento que mandamos seria adivinhar: a interseção de acesso acontece DENTRO
 * da função, e o conjunto que ela realmente leu pode ser menor que o pedido.
 *
 * ─── O ENRIQUECIMENTO É O MESMO ─────────────────────────────────────────────
 *
 * Nome do lead e etiquetas vêm de `enriquecerContatos`, o mesmo módulo que a
 * lista de uma caixa usa — inclusive a regra de que a falha SOBE quando o filtro
 * recorta por etiqueta. Funil e qualificação continuam sendo enriquecidos pelo
 * shell (`useLeadInboxMeta`), fora daqui.
 *
 * ─── QUEDA PARA AS RPCs DE UMA CAIXA (ordem de deploy) ──────────────────────
 *
 * As funções `_multi` chegam pela migration `20270926000000`, e apply em prod é
 * botão do humano. Se o front subir primeiro, o PostgREST não acha a função
 * (`PGRST202`) e o `/chat` INTEIRO fica vazio — para todas as organizações, por
 * causa de uma capacidade que a maioria delas nem usa.
 *
 * Então, e SÓ nesse código, a queda é para as funções de uma caixa, uma chamada
 * por caixa marcada. Isso perde a garantia do limite global (D3): com duas
 * caixas movimentadas, a paginação volta a poder esconder conversa. É pior que o
 * desenho e MUITO melhor que a tela vazia — e no caso comum, uma caixa marcada,
 * a queda é byte a byte o comportamento de hoje. Qualquer outro erro sobe.
 */
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import {
  UNFILTERED_PAGE_LIMIT,
  type InboxServerFilter,
} from "@/modules/communication/lib/inboxFilterServer";
import {
  unificarCaixas,
  type CaixaDaLinha,
  type EntradaUnificada,
  type FonteUnificada,
  type LinhaUnificada,
} from "@/modules/communication/lib/caixaUnificada";
import { chatQueryKeys } from "./shared/queryKeys";
import { enriquecerContatos } from "./shared/enriquecerContatos";
import { boxUsesChannelMessages } from "./inbox-box-source";
import { toSocialContact, type SocialConversationRow } from "./social-conversation-row";
import type { ChatContact, InboxBox, SocialContact } from "./types";

/**
 * A porta para as RPCs que `types.ts` ainda não conhece.
 *
 * `src/integrations/supabase/types.ts` é gerado a partir de prod, e as três
 * funções desta onda entraram lá depois do arquivo. Até o próximo regen, o
 * cliente tipado recusa os nomes novos.
 *
 * O escape é NOMEADO em vez de `(supabase as any)` espalhado: assim o retorno
 * continua checado (`data` é `unknown`, e quem consome declara a forma em
 * `LinhaDeChip`/`LinhaOficial`), e a busca por este tipo mostra exatamente
 * quantos call-sites esperam o regen.
 */
type ChamadaDeRpcNova = (
  nome: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

/**
 * ⚠️ A CHAMADA ATRAVESSA O OBJETO, SEMPRE. `supabase.rpc` é um MÉTODO do
 * PostgrestClient e usa `this` para montar a URL e os headers. Guardá-lo numa
 * const solta (`const f = supabase.rpc`) desamarra o receptor: a chamada estoura
 * DENTRO do `queryFn`, antes de tocar a rede — nenhuma requisição sai, nenhum
 * status aparece no log, e a lista fica vazia como se a org não tivesse
 * conversa. Foi assim que o /chat de produção ficou vazio em 04/09.
 *
 * O dublê dos testes (`{ rpc: (...a) => mock(...a) }`) é um objeto simples e
 * sobrevive ao desamarre — por isso a suíte passou verde enquanto produção
 * quebrava. O teste que fecha esse buraco usa um dublê que LÊ `this`.
 */
function chamarRpcNova(
  nome: string,
  args: Record<string, unknown>,
): ReturnType<ChamadaDeRpcNova> {
  return (supabase as unknown as { rpc: ChamadaDeRpcNova }).rpc(nome, args);
}

/** Teto da lista do canal oficial. O mesmo da caixa isolada — 22 conversas em prod. */
const LIMITE_OFICIAL = 200;

/** Teto por canal social. O mesmo que `useSocialContacts` usava sozinho. */
const LIMITE_SOCIAL = 200;

/**
 * O PostgREST não achou a função. É o código que a ordem de deploy produz —
 * front novo contra base sem a migration —, e o ÚNICO que autoriza a queda.
 * Estreito de propósito: qualquer outro erro (permissão, argumento, timeout)
 * precisa subir, senão a queda vira um jeito de esconder defeito.
 */
function ehFuncaoAusente(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "PGRST202";
}

/** Linha crua de `get_whatsapp_conversation_list_multi`. */
interface LinhaDeChip {
  instance_id: string;
  phone_number: string;
  normalized_phone: string | null;
  push_name: string | null;
  last_message: string | null;
  last_message_time: string;
  last_message_direction: string | null;
  last_message_sent_source: string | null;
  lead_id: string | null;
  is_group: boolean | null;
  conversation_id: string | null;
  archived_at: string | null;
  unread_count: number | null;
}

/** A linha do canal oficial no formato multi — a de sempre, mais a caixa de origem. */
type LinhaOficial = SocialConversationRow & { instance_id: string };

function caixaDaLinha(caixa: InboxBox): CaixaDaLinha {
  return {
    id: caixa.id,
    nome: caixa.name,
    kind: caixa.kind,
    oficial: caixa.kind === "whatsapp" && boxUsesChannelMessages(caixa),
  };
}

export interface UseConversasUnificadasResult {
  linhas: LinhaUnificada[];
  /** Houve corte: existe conversa mais antiga que a página não trouxe. */
  truncada: boolean;
  isLoading: boolean;
  /**
   * Alguma das duas fontes está buscando AGORA, inclusive em refetch de fundo.
   *
   * Diferente de `isLoading`, que é só a primeira busca: a bolha usa este para
   * o indicador discreto de "atualizando" sem trocar a lista por esqueleto.
   */
  isFetching: boolean;
  /**
   * Alguma das duas fontes falhou. Segue o mesmo contrato da lista de uma caixa:
   * com filtro de etiqueta ativo, o erro precisa chegar ao gate em vez de virar
   * lista vazia — vazio passa por resposta e não é.
   */
  isError: boolean;
}

export function useConversasUnificadas(
  caixas: readonly InboxBox[],
  serverFilter?: InboxServerFilter,
): UseConversasUnificadasResult {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  const filterArgs = serverFilter?.args ?? null;
  const limiteChip = serverFilter?.limit ?? UNFILTERED_PAGE_LIMIT;
  const tagsCriticas = filterArgs?.p_tags != null;

  // Ids ORDENADOS: a mesma seleção em ordem diferente é a mesma pergunta.
  const chips = useMemo(
    () =>
      caixas
        .filter((c) => c.kind === "whatsapp" && !boxUsesChannelMessages(c))
        .sort((a, b) => a.id.localeCompare(b.id)),
    [caixas],
  );
  const oficiais = useMemo(
    () =>
      caixas
        .filter((c) => c.kind === "whatsapp" && boxUsesChannelMessages(c))
        .sort((a, b) => a.id.localeCompare(b.id)),
    [caixas],
  );

  const canaisSociais = useMemo(
    () => caixas.filter((c) => c.kind === "instagram").sort((a, b) => a.id.localeCompare(b.id)),
    [caixas],
  );

  const idsChip = useMemo(() => chips.map((c) => c.id), [chips]);
  const idsOficiais = useMemo(() => oficiais.map((c) => c.id), [oficiais]);

  const queryChips = useQuery({
    queryKey: chatQueryKeys.contactsMulti(organizationId, idsChip, serverFilter?.cacheKey),
    queryFn: async (): Promise<{ contatos: ChatContact[]; cheia: boolean }> => {
      if (!organizationId || idsChip.length === 0) return { contatos: [], cheia: false };

      // Cast do CLIENTE: a RPC é da W1 e `integrations/supabase/types.ts` só a
      // conhece depois do regen contra a base onde a migration entrou. O shape
      // fica declarado em `LinhaDeChip`, para coluna renomeada aparecer como
      // erro de tipo aqui e não como `undefined` na tela.
      let { data, error } = await chamarRpcNova(
        "get_whatsapp_conversation_list_multi",
        {
          p_org: organizationId,
          p_instances: idsChip,
          p_limit: limiteChip,
          ...(filterArgs ?? {}),
        },
      );

      if (ehFuncaoAusente(error)) {
        console.warn(
          "[inbox] `get_whatsapp_conversation_list_multi` não existe nesta base — " +
            "migration 20270926000000 ainda não aplicada. A lista cai para uma " +
            "chamada por caixa, e o limite deixa de ser global.",
        );
        const porCaixa = await Promise.all(
          idsChip.map(async (id) => {
            const r = await chamarRpcNova("get_whatsapp_conversation_list", {
              p_org: organizationId,
              p_instance: id,
              p_limit: limiteChip,
              ...(filterArgs ?? {}),
            });
            if (r.error) throw r.error;
            // A função antiga NÃO devolve `instance_id`: a caixa é o argumento
            // que mandamos, e aqui isso é verdade porque a chamada é uma por
            // caixa. É o único ponto do arquivo onde derivar do argumento é
            // legítimo.
            return ((r.data ?? []) as LinhaDeChip[]).map((linha) => ({
              ...linha,
              instance_id: id,
            }));
          }),
        );
        data = porCaixa.flat();
        error = null;
      }

      if (error) throw error;

      const linhas = (data ?? []) as LinhaDeChip[];
      const contatos: ChatContact[] = linhas.map((r) => ({
        channel: "whatsapp",
        // A caixa sai da RESPOSTA, nunca do argumento — ver cabeçalho.
        instance_id: r.instance_id,
        phone_number: r.phone_number,
        push_name: r.push_name,
        last_message: r.last_message,
        last_message_time: r.last_message_time,
        last_message_direction:
          r.last_message_direction === "incoming" || r.last_message_direction === "outgoing"
            ? r.last_message_direction
            : null,
        last_message_sent_source:
          r.last_message_sent_source === "manual" ||
          r.last_message_sent_source === "copilot" ||
          r.last_message_sent_source === "workflow"
            ? r.last_message_sent_source
            : null,
        unread_count: r.unread_count ?? 0,
        lead_id: r.lead_id,
        lead_name: null,
        conversation_id: r.conversation_id,
        archived_at: r.archived_at,
        tags: [],
        is_group: r.is_group === true,
        funnels: [],
        qualification_tier: null,
      }));

      await enriquecerContatos(contatos, { tagsCriticas });

      // `cheia` é medido, não presumido: é o que sustenta o piso de confiança do
      // motor. Uma org com menos conversas que o limite ficaria marcada como
      // truncada para sempre se o valor fosse chutado.
      return { contatos, cheia: linhas.length >= limiteChip };
    },
    enabled: !!organizationId && idsChip.length > 0,
    staleTime: 30_000,
  });

  const queryOficiais = useQuery({
    queryKey: chatQueryKeys.officialContactsMulti(organizationId, idsOficiais),
    queryFn: async () => {
      if (!organizationId || idsOficiais.length === 0) {
        return { contatos: [] as ReturnType<typeof toSocialContact>[], cheia: false };
      }

      let { data, error } = await chamarRpcNova(
        "get_official_whatsapp_conversation_list_multi",
        {
          p_org: organizationId,
          p_instances: idsOficiais,
          p_limit: LIMITE_OFICIAL,
        },
      );

      if (ehFuncaoAusente(error)) {
        const porCaixa = await Promise.all(
          idsOficiais.map(async (id) => {
            const r = await chamarRpcNova(
              "get_official_whatsapp_conversation_list",
              { p_org: organizationId, p_instance: id, p_limit: LIMITE_OFICIAL },
            );
            if (r.error) throw r.error;
            return ((r.data ?? []) as SocialConversationRow[]).map((linha) => ({
              ...linha,
              instance_id: id,
            }));
          }),
        );
        data = porCaixa.flat();
        error = null;
      }

      if (error) throw error;

      const linhas = (data ?? []) as LinhaOficial[];
      return {
        contatos: linhas.map((row) =>
          // O terceiro argumento é a CAIXA da linha, e ela vem da coluna: com
          // duas caixas oficiais marcadas, usar a primeira do array daria a
          // todas as conversas a mesma `conversation_key` de caixa errada — e o
          // read-state passaria a zerar a não-lida da conversa alheia.
          toSocialContact(row, "whatsapp_oficial", row.instance_id),
        ),
        cheia: linhas.length >= LIMITE_OFICIAL,
      };
    },
    enabled: !!organizationId && idsOficiais.length > 0,
    staleTime: 30_000,
  });

  /**
   * Os canais sociais, um por chamada.
   *
   * `useQueries` e não um `useQuery` com laço dentro: assim cada canal tem a
   * própria entrada de cache, sob a MESMA raiz que `useSocialRealtime` invalida
   * — o tempo real do Instagram continua vindo de graça, como já vinha quando a
   * caixa abria sozinha.
   */
  const queriesSociais = useQueries({
    queries: canaisSociais.map((canal) => ({
      queryKey: chatQueryKeys.socialContacts(organizationId, canal.id),
      queryFn: async (): Promise<SocialContact[]> => {
        if (!organizationId) return [];
        const { data, error } = await chamarRpcNova("get_social_conversation_list", {
          p_org: organizationId,
          p_channel: canal.id,
          p_limit: LIMITE_SOCIAL,
        });
        if (error) throw error;
        return ((data ?? []) as SocialConversationRow[]).map((row) =>
          toSocialContact(row, "instagram", canal.id),
        );
      },
      enabled: !!organizationId,
      staleTime: 30_000,
    })),
  });

  /**
   * A assinatura do que as fontes sociais já responderam.
   *
   * `queriesSociais` é recriado a cada render, então ele não serve de
   * dependência; o que muda de verdade é o instante da última resposta de cada
   * canal. Extraído para variável porque a regra de hooks não consegue conferir
   * expressão montada dentro do array.
   */
  const assinaturaSocial = queriesSociais.map((q) => q.dataUpdatedAt).join("|");

  const { linhas, truncada } = useMemo(() => {
    const porId = new Map<string, CaixaDaLinha>();
    for (const caixa of [...chips, ...oficiais, ...canaisSociais]) {
      porId.set(caixa.id, caixaDaLinha(caixa));
    }

    // Linha de caixa que não está no conjunto pedido é descartada: a RPC recorta
    // por acesso, então isso não deveria acontecer — e se acontecer, a lista
    // mostraria uma conversa sem caixa para abrir.
    const casar = (
      contatos: readonly { instance_id?: string | null; messaging_channel_id?: string }[],
    ) =>
      contatos.flatMap((contato) => {
        const id =
          "instance_id" in contato && contato.instance_id
            ? contato.instance_id
            : (contato as { messaging_channel_id?: string }).messaging_channel_id;
        const caixa = id ? porId.get(id) : undefined;
        return caixa ? [{ contato, caixa } as EntradaUnificada] : [];
      });

    const fontes: FonteUnificada[] = [
      { entradas: casar(queryChips.data?.contatos ?? []), cheia: queryChips.data?.cheia ?? false },
      {
        entradas: casar(queryOficiais.data?.contatos ?? []),
        cheia: queryOficiais.data?.cheia ?? false,
      },
      // Cada canal social é uma FONTE própria: o piso de confiança do motor é
      // por fonte, e juntá-las numa só faria o corte de um canal cheio esconder
      // conversa de outro que nem estava perto do limite.
      ...queriesSociais.map((q) => ({
        entradas: casar(q.data ?? []),
        cheia: (q.data?.length ?? 0) >= LIMITE_SOCIAL,
      })),
    ];

    return unificarCaixas(fontes, { limite: limiteChip });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    chips,
    oficiais,
    canaisSociais,
    queryChips.data,
    queryOficiais.data,
    assinaturaSocial,
    limiteChip,
  ]);

  return {
    linhas,
    truncada,
    // Só espera a fonte que foi de fato consultada: com uma caixa de Chip só, a
    // query do canal oficial nasce desligada, e `isLoading` de query desligada é
    // falso — mas ser explícito aqui evita que uma mudança no TanStack deixe a
    // lista em esqueleto eterno.
    isLoading:
      (idsChip.length > 0 && queryChips.isLoading) ||
      (idsOficiais.length > 0 && queryOficiais.isLoading) ||
      queriesSociais.some((q) => q.isLoading),
    isFetching:
      queryChips.isFetching ||
      queryOficiais.isFetching ||
      queriesSociais.some((q) => q.isFetching),
    isError:
      queryChips.isError || queryOficiais.isError || queriesSociais.some((q) => q.isError),
  };
}
