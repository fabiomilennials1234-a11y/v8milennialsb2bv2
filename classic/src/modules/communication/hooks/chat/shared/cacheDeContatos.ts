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
