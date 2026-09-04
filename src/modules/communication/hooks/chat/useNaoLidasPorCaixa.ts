/**
 * `useNaoLidasPorCaixa` — quantas não-lidas existem em CADA caixa que a pessoa
 * pode ler, marcadas ou não no seletor.
 *
 * ─── POR QUE O ACESSO, E NÃO A SELEÇÃO (D8 do spec) ─────────────────────────
 *
 * O badge agregado já soma hoje todas as instâncias PERMITIDAS enquanto a lista
 * mostra só a selecionada — a discrepância existe e é mantida de propósito.
 * Desmarcar uma caixa é dizer o que se quer VER, nunca o que se quer deixar de
 * receber: perder mensagem de cliente por causa de um filtro é o pior defeito
 * que esta tela pode ter. O que a fatia acrescenta é dizer ONDE está o que não
 * se está vendo — por isso a contagem é por caixa, e por isso a entrada é o
 * conjunto que a pessoa pode LER, não o que ela marcou.
 *
 * ─── ALCANCE REAL: NEM TODA CAIXA TEM FONTE ─────────────────────────────────
 *
 * `get_unread_counts` conta em `whatsapp_messages`. As caixas que recebem em
 * `channel_messages` — o canal oficial (provider `notificame`) e o Instagram —
 * NÃO têm linha lá, e uma soma ingênua devolveria zero para elas. Zero é uma
 * afirmação ("nada novo aqui") que esta função não pode fazer sobre uma caixa
 * que ela não lê: foi exatamente assim que a mensagem do canal oficial ficou
 * invisível em 18/08, com a caixa existindo e a leitura indo na tabela errada.
 *
 * Então a contagem é a que TEM, e o que não tem sai marcado (`sem-fonte`, com
 * `naoLidas: null`). Quem desenha decide entre não acender ponto nenhum e
 * acender um sinal declaradamente parcial — mas decide sabendo. Uma caixa que
 * nunca acende é uma promessa quebrada; um zero mentiroso é pior, porque ela
 * parece estar respondendo.
 *
 * ⚠️ Fechar a lacuna é uma função irmã sobre `channel_messages`, fora desta
 * fatia. Enquanto ela não existe, `parcial` é o que o shell tem para saber que
 * o seletor não pode prometer cobertura total.
 *
 * ─── O QUE A RPC CONTA (verificado na definição viva) ───────────────────────
 *
 * Uma linha por conversa não lida, `(instance_id, normalized_phone, unread)`.
 * Recorte: `direction = 'incoming'`, sem apagadas, SEM GRUPOS, últimos 30 dias,
 * e mais novas que `last_read_at` do usuário (ou que 7 dias atrás, quando ele
 * nunca leu aquela conversa). É o MESMO recorte de `get_unread_total`, que é o
 * badge global — os dois números fecham por construção, e é isso que faz o
 * ponto no seletor e o badge contarem a mesma história.
 *
 * A agregação por instância é no cliente porque a RPC já devolve o grão pronto:
 * somar `unread` das linhas é aritmética sobre o que o servidor contou, não uma
 * segunda contagem de mensagem.
 *
 * ⚠️ A RPC cruza `p_instance_ids` apenas com as ORGS do usuário, e não com a
 * lista de instâncias permitidas a ele (diferente das funções de lista da W1,
 * que fazem a interseção dentro). Quem manda o conjunto é o dono do recorte:
 * passe `useInboxBoxes().boxes`, que já nasce restrito por membro.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { boxUsesChannelMessages } from "./inbox-box-source";
import type { InboxBox } from "./types";

/**
 * O que se sabe sobre a contagem de uma caixa.
 *
 * - `contada` — o número é o número.
 * - `sem-fonte` — a caixa lê `channel_messages`; esta função não a alcança.
 * - `indisponivel` — ainda carregando, ou a RPC falhou.
 */
export type EstadoDaContagem = "contada" | "sem-fonte" | "indisponivel";

export interface NaoLidasDaCaixa {
  caixaId: string;
  estado: EstadoDaContagem;
  /**
   * `null` fora de `contada`, e nunca `0`.
   *
   * O tipo é o guarda: `0` seria lido como "sem novidade" por qualquer
   * `naoLidas > 0` distraído, enquanto `null` cai no ramo "não acende" sem
   * nunca afirmar que a caixa está em dia.
   */
  naoLidas: number | null;
}

export interface UseNaoLidasPorCaixaResult {
  /** Toda caixa pedida está aqui — inclusive a que tem zero e a que não tem fonte. */
  porCaixa: Map<string, NaoLidasDaCaixa>;
  /** Ids das caixas que esta função não alcança. Vazio na maioria das orgs. */
  semFonte: string[];
  /** `true` quando alguma caixa pedida ficou sem fonte: a cobertura é parcial. */
  parcial: boolean;
  isLoading: boolean;
  isError: boolean;
}

/**
 * A queryKey mora aqui, e não em `chatQueryKeys`, porque esta contagem não é do
 * eixo da lista: ela segue o ACESSO e sobrevive a qualquer mudança de seleção.
 * Exportada para que a invalidação (realtime, marcar como lida) tenha um nome só
 * a que se referir em vez de remontar a tupla de memória.
 */
export function naoLidasPorCaixaQueryKey(
  organizationId: string | null | undefined,
  idsOrdenados: readonly string[],
) {
  return ["nao_lidas_por_caixa", organizationId ?? null, idsOrdenados.join(",")] as const;
}

/** Contagem crua da RPC, já somada por instância. Record e não Map: o cache do
 * TanStack faz structural sharing sobre valor JSON, e um Map remontaria a
 * identidade a cada refetch, re-renderizando o seletor sem novidade nenhuma. */
type SomaPorInstancia = Record<string, number>;

export function useNaoLidasPorCaixa(
  caixas: readonly InboxBox[],
): UseNaoLidasPorCaixaResult {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  // Ordenado: a mesma seleção em ordem diferente é a MESMA pergunta, e sem a
  // ordenação ela abriria duas entradas de cache com a mesma resposta.
  const idsComFonte = useMemo(
    () =>
      caixas
        .filter((caixa) => !boxUsesChannelMessages(caixa))
        .map((caixa) => caixa.id)
        .sort(),
    [caixas],
  );

  const semFonte = useMemo(
    () => caixas.filter(boxUsesChannelMessages).map((caixa) => caixa.id),
    [caixas],
  );

  const query = useQuery({
    queryKey: naoLidasPorCaixaQueryKey(organizationId, idsComFonte),
    queryFn: async (): Promise<SomaPorInstancia> => {
      const { data, error } = await supabase.rpc("get_unread_counts", {
        p_instance_ids: idsComFonte as string[],
      });
      if (error) throw error;

      // Semeia com zero ANTES de somar: instância sem nenhuma conversa não lida
      // simplesmente não volta na resposta, e sem a semente ela sumiria do mapa
      // — indistinguível de uma caixa que a pessoa perdeu o acesso.
      const soma: SomaPorInstancia = {};
      for (const id of idsComFonte) soma[id] = 0;

      for (const linha of data ?? []) {
        const id = linha.instance_id;
        // Linha de caixa que não pedimos é descartada em silêncio: a RPC recorta
        // por org, não pelo conjunto pedido, e somá-la inflaria uma caixa que
        // este resultado nem representa.
        if (!id || soma[id] === undefined) continue;
        soma[id] += linha.unread ?? 0;
      }
      return soma;
    },
    // Sem org não há multi-tenant que feche; sem caixa com fonte não há pergunta
    // a fazer — e uma org só de canal oficial não pode gastar uma ida à rede
    // para receber a resposta vazia que já sabemos.
    enabled: !!organizationId && idsComFonte.length > 0,
    // Curto porque a novidade é o produto: o ponto no seletor existe para
    // aparecer logo. O refetch de fundo é de 60s, a MESMA cadência que o badge
    // global já paga, porque o realtime de mensagens invalida os caches da
    // lista — e uma caixa DESMARCADA não tem lista para ser invalidada. Sem
    // esse fundo, justamente a caixa que o seletor precisa acender é a que
    // nunca acenderia.
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const porCaixa = useMemo(() => {
    const semFonteSet = new Set(semFonte);
    const mapa = new Map<string, NaoLidasDaCaixa>();
    for (const caixa of caixas) {
      if (semFonteSet.has(caixa.id)) {
        mapa.set(caixa.id, { caixaId: caixa.id, estado: "sem-fonte", naoLidas: null });
        continue;
      }
      const contagem = query.data?.[caixa.id];
      mapa.set(
        caixa.id,
        contagem === undefined
          ? { caixaId: caixa.id, estado: "indisponivel", naoLidas: null }
          : { caixaId: caixa.id, estado: "contada", naoLidas: contagem },
      );
    }
    return mapa;
  }, [caixas, semFonte, query.data]);

  return {
    porCaixa,
    semFonte,
    parcial: semFonte.length > 0,
    // `isLoading` do TanStack já é falso quando a query está desligada — o
    // seletor de uma org sem caixa com fonte não pode ficar em esqueleto eterno.
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
