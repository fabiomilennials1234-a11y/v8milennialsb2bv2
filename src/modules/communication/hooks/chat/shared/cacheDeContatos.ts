/**
 * A raiz `whatsapp_contacts` guarda DUAS formas, e quem escreve nela precisa
 * saber disso.
 *
 * ─── COMO AS DUAS FORMAS PASSARAM A DIVIDIR A MESMA RAIZ ────────────────────
 *
 * `chatQueryKeys.contacts` (a lista de UMA caixa) guarda `ChatContact[]` — um
 * array cru, como a RPC devolve. `chatQueryKeys.contactsMulti` (a lista por
 * CONJUNTO de caixas, que é a que o `/chat` e a bolha realmente renderizam
 * desde a W2) guarda `{ contatos, cheia }`: o array MAIS a medida de corte, que
 * o motor da lista unificada precisa para saber se a página escondeu conversa.
 *
 * As duas dividem a raiz de propósito — é assim que um patch de tempo real
 * alcança todas as variantes com um `setQueriesData` de PREFIXO, e uma lista
 * fora da raiz pararia de receber patch (ver `queryKeys.ts`).
 *
 * ─── O QUE ISSO CUSTOU EM 04/09 ─────────────────────────────────────────────
 *
 * `setQueriesData`/`findAll` casam por PREFIXO. Quem mira a raiz recebe as duas
 * formas no mesmo laço, e três escritores tratavam o valor como array direto:
 *
 *   - `markConversationRead` (`ChatShellWithContext`) — `old?.map(...)`
 *   - o mark-read da bolha (`ChatBubbleThread`)        — `prev.map(...)`
 *   - o patch da sidebar (`useWhatsAppRealtime`)       — `prev.findIndex(...)`
 *
 * Contra a entrada `multi:` o valor é um OBJETO, e o array não tem método
 * nenhum ali: `Te.map is not a function` subiu ao ErrorBoundary e derrubou a
 * tela inteira ao ABRIR qualquer conversa — no `/chat` e na bolha.
 *
 * O erro não estava em mirar a raiz (isso é o desenho), e sim em presumir a
 * forma depois de mirá-la. Estas duas funções são o par que fecha o buraco:
 * `contatosDoCache` LÊ sem presumir, `comContatos` DEVOLVE preservando o
 * envelope — a lista unificada continua com o `cheia` que o motor mediu, em vez
 * de perdê-lo num patch de não-lida.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { ChatContact } from "../types";
import { normalizePhone } from "@/lib/normalizePhone";
import { sortContactsByRecency } from "@/modules/communication/lib/sortContactsByRecency";
import { pedirReconciliacaoDaLista } from "../chatReconcile";
import { MULTI_KEY_PREFIX } from "./queryKeys";

/** O envelope da lista por conjunto de caixas. Espelha `useConversasUnificadas`. */
interface ListaUnificadaEmCache {
  contatos: ChatContact[];
  cheia: boolean;
}

/** As duas formas que a raiz `whatsapp_contacts` guarda. */
export type CacheDeContatos = ChatContact[] | ListaUnificadaEmCache;

/**
 * Os contatos de uma entrada de cache, seja qual for a forma.
 *
 * Devolve `null` — e não `[]` — quando não reconhece o valor. A diferença
 * importa: `[]` faria o chamador gravar uma lista VAZIA por cima de uma entrada
 * que ele não entendeu, e a tela ficaria em branco. `null` manda ele devolver o
 * valor anterior intacto.
 */
export function contatosDoCache(valor: unknown): ChatContact[] | null {
  if (Array.isArray(valor)) return valor as ChatContact[];
  if (valor && typeof valor === "object") {
    const { contatos } = valor as Partial<ListaUnificadaEmCache>;
    if (Array.isArray(contatos)) return contatos;
  }
  return null;
}

/**
 * Recoloca os contatos na MESMA forma de onde saíram.
 *
 * O envelope é preservado por spread em vez de reconstruído campo a campo: se a
 * lista unificada ganhar um terceiro campo, ele sobrevive ao patch sozinho, sem
 * ninguém precisar lembrar de vir aqui.
 */
export function comContatos<T>(anterior: T, contatos: ChatContact[]): T {
  if (Array.isArray(anterior)) return contatos as unknown as T;
  return { ...(anterior as object), contatos } as T;
}

/**
 * Zera a não-lida das linhas que `casa` aponta, em TODAS as variantes sob
 * `raiz` — e em qualquer das duas formas.
 *
 * Existe como função única porque os dois lugares que abrem conversa (o `/chat`
 * e a bolha) fazem exatamente esta operação, e foi tê-la escrita duas vezes que
 * deixou as duas quebrarem juntas em 04/09. O que muda entre elas é só o
 * critério de "esta é a linha que acabou de ser lida" — daí ele ser o
 * parâmetro, e o resto ser deste arquivo.
 *
 * O predicado recebe o contato inteiro de propósito: no `/chat` a linha é
 * `(caixa, telefone)`, e casar só pelo telefone apagaria também a não-lida do
 * mesmo contato na outra caixa — que é outra conversa e ninguém leu.
 */
export function zerarNaoLidas(
  queryClient: QueryClient,
  raiz: readonly unknown[],
  casa: (contato: ChatContact) => boolean,
): void {
  queryClient.setQueriesData<CacheDeContatos>({ queryKey: raiz }, (anterior) => {
    const atuais = contatosDoCache(anterior);
    if (!atuais) return anterior;

    // Sai cedo quando nada casa: sem isto, todo mark-read cria um array novo em
    // cada variante de cache da org e o TanStack re-renderiza listas que não
    // mudaram em nada.
    if (!atuais.some((c) => c.unread_count !== 0 && casa(c))) return anterior;

    return comContatos(
      anterior,
      atuais.map((c) => (casa(c) ? { ...c, unread_count: 0 } : c)),
    );
  });
}

/** O que um envio que SAIU muda na linha da conversa. */
export interface EnvioParaALista {
  organizationId: string;
  instanceId: string | null;
  phoneNumber: string;
  /** Prévia: o texto, a legenda, ou `null` (mídia sem legenda → mantém a anterior). */
  conteudo: string | null;
  timestamp: string;
}

/** A entrada de cache (lista de UMA caixa ou `multi:`) mostra esta caixa? */
function listaMostraACaixa(queryKey: readonly unknown[], instanceId: string): boolean {
  const eixo = queryKey[2];
  if (typeof eixo !== "string") return false;
  if (!eixo.startsWith(MULTI_KEY_PREFIX)) return eixo === instanceId;
  return eixo.slice(MULTI_KEY_PREFIX.length).split(",").includes(instanceId);
}

/**
 * Reflete um envio na linha da conversa, em TODAS as listas em cache que
 * mostram aquela caixa — no lugar, sem refetch.
 *
 * Substitui a invalidação da raiz `["whatsapp_contacts"]` que o envio fazia:
 * aquela refazia a RPC de lista de toda variante em cache da org (filtros,
 * caixas, bolha) a cada mensagem enviada. Aqui o custo é zero RPC no caso
 * comum, e UMA invalidação EXATA — pelo teto de `chatReconcile.ts` — só na
 * lista que ainda não tem a linha (primeira mensagem de uma conversa nova).
 *
 * Mesmo casamento do patch de realtime (`useWhatsAppRealtime.ts`): a linha é
 * `(caixa, telefone)`. O eco do webhook chega depois e é descartado lá por
 * `msgTime <= existingTime` quando não traz nada mais novo.
 */
export function registrarEnvioNaLista(queryClient: QueryClient, envio: EnvioParaALista): void {
  if (!envio.instanceId) return;
  const instanceId = envio.instanceId;
  const telefone = normalizePhone(envio.phoneNumber) ?? envio.phoneNumber;
  const raiz = ["whatsapp_contacts", envio.organizationId] as const;

  for (const query of queryClient.getQueryCache().findAll({ queryKey: raiz })) {
    if (!listaMostraACaixa(query.queryKey, instanceId)) continue;
    const contatos = contatosDoCache(query.state.data);
    if (!contatos) continue;
    const casa = (c: ChatContact) =>
      (normalizePhone(c.phone_number) ?? c.phone_number) === telefone &&
      (c.instance_id == null || c.instance_id === instanceId);
    if (!contatos.some(casa)) {
      pedirReconciliacaoDaLista(queryClient, query.queryKey);
      continue;
    }
    queryClient.setQueryData<CacheDeContatos>(query.queryKey, (anterior) => {
      const atuais = contatosDoCache(anterior);
      if (!atuais) return anterior;
      const patched = atuais.map((c) =>
        casa(c)
          ? {
              ...c,
              last_message: envio.conteudo ?? c.last_message,
              last_message_time: envio.timestamp,
              last_message_direction: "outgoing" as const,
              last_message_sent_source: "manual" as const,
            }
          : c,
      );
      return comContatos(anterior, sortContactsByRecency(patched));
    });
  }
}
