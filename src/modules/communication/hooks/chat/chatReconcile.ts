/**
 * Reconciliação do chat por EVENTO, com teto de vazão — espelho de
 * `unreadRefresh.ts` (mesmo throttle, mesma regra de aba oculta).
 *
 * ─── POR QUE ISTO EXISTE (incidente OOM 2026-10-05) ─────────────────────────
 *
 * O polling do chat passou a ser LENTO (`reconcilePolicy.ts`: 120 s na thread,
 * 300 s na lista com canal saudável). O que sustenta a latência baixa agora são
 * os momentos em que há motivo real para desconfiar do cache:
 *
 *   1. o canal RECONECTOU (`joinCount` subiu): eventos emitidos durante a queda
 *      se perderam — o postgres_changes não reenvia;
 *   2. chegou mensagem de um contato que a lista em cache não tem (Fase B):
 *      não há linha para patchar, só a RPC sabe montar a conversa nova.
 *
 * ─── O TETO ─────────────────────────────────────────────────────────────────
 *
 * Throttle de borda dupla (`criarThrottle`), UM por QueryClient (= um por aba)
 * e por alvo, janela de 15 s: evento isolado reage na hora; rajada colapsa em
 * no máximo 1 disparo extra por janela.
 *
 * `cancelRefetch: false` em toda invalidação: se a query já está buscando, o
 * pedido pega carona no fetch em voo em vez de cancelá-lo e abrir outro —
 * cancelar uma RPC de 11–15 s no pico e recomeçar é pagar duas vezes.
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { normalizePhone } from "@/lib/normalizePhone";
import { criarThrottle, type Relogio, type Throttle } from "./unreadRefresh";
import { contatosDoCache, listaMostraCaixa } from "./shared/cacheDeContatos";

/** Teto de vazão: no máximo uma reconciliação por alvo por aba a cada 15 s. */
export const CHAT_RECONCILE_MIN_INTERVAL_MS = 15_000;

const relogioReal: Relogio = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

function abaEscondida(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function invalidar(queryClient: QueryClient, queryKey: QueryKey): void {
  void queryClient.invalidateQueries(
    { queryKey, refetchType: abaEscondida() ? "none" : "active" },
    { cancelRefetch: false },
  );
}

/**
 * Throttles por QueryClient e por alvo. WeakMap pelo mesmo motivo de
 * `unreadRefresh.ts`: cada teste cria o seu QueryClient, e um throttle global
 * vazaria a janela de um caso para o seguinte.
 */
const throttles = new WeakMap<QueryClient, Map<string, Throttle>>();

function pedir(
  queryClient: QueryClient,
  alvo: string,
  executar: () => void,
  relogio: Relogio,
): void {
  let porAlvo = throttles.get(queryClient);
  if (!porAlvo) {
    porAlvo = new Map();
    throttles.set(queryClient, porAlvo);
  }
  let throttle = porAlvo.get(alvo);
  if (!throttle) {
    throttle = criarThrottle(executar, CHAT_RECONCILE_MIN_INTERVAL_MS, relogio);
    porAlvo.set(alvo, throttle);
  }
  throttle.request();
}

/**
 * Reconcilia thread e lista da org inteira — as raízes `whatsapp_messages` e
 * `whatsapp_contacts`, sempre com a org na chave (multi-tenant).
 */
export function pedirReconciliacaoDoChat(
  queryClient: QueryClient,
  organizationId: string,
  relogio: Relogio = relogioReal,
): void {
  pedir(
    queryClient,
    `chat:${organizationId}`,
    () => {
      invalidar(queryClient, ["whatsapp_messages", organizationId]);
      invalidar(queryClient, ["whatsapp_contacts", organizationId]);
    },
    relogio,
  );
}

/** Último `joinCount` já tratado, por QueryClient e org. */
const joinsTratados = new WeakMap<QueryClient, Map<string, number>>();

/**
 * Chamado quando o `joinCount` do canal de mensagens muda.
 *
 * - `joinCount === 1` é o primeiro join da aba: o cache acabou de nascer, não
 *   há o que reconciliar.
 * - O status do canal é compartilhado por dois montadores (bolha e /chat). Os
 *   dois veem o MESMO `joinCount`; só o primeiro a tratar dispara.
 */
export function reconciliarAposReconexao(
  queryClient: QueryClient,
  organizationId: string,
  joinCount: number,
  relogio: Relogio = relogioReal,
): void {
  let porOrg = joinsTratados.get(queryClient);
  if (!porOrg) {
    porOrg = new Map();
    joinsTratados.set(queryClient, porOrg);
  }
  const tratado = porOrg.get(organizationId) ?? 0;
  if (joinCount <= tratado) return;
  porOrg.set(organizationId, joinCount);
  if (joinCount <= 1) return;
  pedirReconciliacaoDoChat(queryClient, organizationId, relogio);
}

/**
 * Mensagem de contato que a lista em cache não tem: refaz AQUELA lista, pelo
 * teto. Borda de ataque mantém o evento isolado instantâneo; rajada (campanha
 * respondida, por exemplo) colapsa em 1 por janela.
 */
export function pedirReconciliacaoDaLista(
  queryClient: QueryClient,
  queryKey: QueryKey,
  relogio: Relogio = relogioReal,
): void {
  pedir(
    queryClient,
    `lista:${JSON.stringify(queryKey)}`,
    () => invalidar(queryClient, queryKey),
    relogio,
  );
}

/**
 * Depois de um ENVIO (perf F3, 19/10).
 *
 * O envio invalidava a raiz `["whatsapp_contacts"]` no `onSettled` — uma RPC de
 * lista multi (~500 ms) por mensagem enviada, sem teto, em todas as listas da
 * aba. Redundante: o INSERT outgoing chega pelo realtime e `useWhatsAppRealtime`
 * já patcha a linha (prévia, hora, ordem) — inclusive pedindo esta mesma
 * reconciliação quando o contato não está na lista.
 *
 * Só a lista que mostra a caixa do envio e AINDA não tem a conversa (primeira
 * mensagem para o contato) precisa da RPC — e vai pelo teto de 15 s, no mesmo
 * alvo que o realtime usa, então os dois pedidos colapsam num só.
 *
 * Escopo inalterado: só listas da org do envio, nunca a raiz sem tenant; a RPC
 * continua decidindo visibilidade. Lista ainda não carregada não tem o que
 * reconciliar.
 *
 * Tradeoff aceito: se o realtime perder o evento outgoing, prévia/ordem da
 * conversa esperam a reconciliação de reconexão, o foco ou o backstop de 300 s.
 */
export function reconciliarListaAposEnvio(
  queryClient: QueryClient,
  organizationId: string | null | undefined,
  phoneNumber: string,
  instanceId: string | null | undefined,
  relogio: Relogio = relogioReal,
): void {
  if (!organizationId) return;
  const fone = normalizePhone(phoneNumber) ?? "";

  for (const query of queryClient.getQueryCache().findAll({
    queryKey: ["whatsapp_contacts", organizationId],
  })) {
    if (instanceId && !listaMostraCaixa(query.queryKey, instanceId)) continue;
    const contatos = contatosDoCache(query.state.data);
    if (!contatos) continue;

    // A linha é `(caixa, telefone)`: o mesmo contato na outra caixa é outra
    // conversa, e não está "na lista" para este envio.
    const temAConversa =
      fone !== "" &&
      contatos.some(
        (c) =>
          normalizePhone(c.phone_number) === fone &&
          (!instanceId || c.instance_id == null || c.instance_id === instanceId),
      );
    if (!temAConversa) pedirReconciliacaoDaLista(queryClient, query.queryKey, relogio);
  }
}

/**
 * Mutação que muda a COMPOSIÇÃO da lista (arquivar, desarquivar, excluir,
 * etiqueta, lead vinculado, transferência, não-lida): o patch local não sabe
 * recalcular filtro, escopo e arquivamento — só a RPC sabe.
 *
 * Refaz JÁ, sem teto: é ação explícita do operador, rara, e ele espera ver o
 * efeito (a conversa arquivada sumir). O teto de 15 s aqui atrasaria a segunda
 * ação seguida. O que muda em relação à invalidação crua da raiz:
 *   - org na chave quando conhecida (multi-tenant; nada de outra org em cache);
 *   - aba oculta só marca stale; refaz ao voltar.
 *
 * ⚠️ SEM `cancelRefetch: false`, ao contrário da reconciliação por evento: um
 * fetch em voo começou ANTES do commit da mutação e devolveria a lista velha —
 * pegar carona nele apagaria o arquivamento da tela até o backstop. Aqui o
 * cancelamento é o que garante ler a própria escrita, e o volume é desprezível.
 */
export function invalidarListaDeConversas(
  queryClient: QueryClient,
  organizationId?: string | null,
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: organizationId ? ["whatsapp_contacts", organizationId] : ["whatsapp_contacts"],
    refetchType: abaEscondida() ? "none" : "active",
  });
}
