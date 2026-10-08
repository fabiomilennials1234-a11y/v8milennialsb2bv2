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
import { criarThrottle, type Relogio, type Throttle } from "./unreadRefresh";

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
