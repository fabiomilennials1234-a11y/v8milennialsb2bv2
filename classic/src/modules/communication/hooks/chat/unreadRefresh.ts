/**
 * Atualização dos contadores de não-lidas — por EVENTO, com teto de vazão.
 *
 * ─── POR QUE ISTO EXISTE (incidente 2026-10-02) ─────────────────────────────
 *
 * `get_unread_total` (badge global, montado em TODA tela pelo ChatBubbleProvider)
 * e `get_unread_counts` (ponto por caixa no seletor do /chat) faziam polling
 * cego de 60 s. Cada aba aberta, focada ou não de fato olhando o número, pagava
 * uma RPC por minuto — e cada uma custava até 14 s no banco (auto_explain).
 * No pico das 12:40 UTC o banco recusou conexão (`too many clients`) e caiu às
 * 12:46. O ranking pré-crash tinha `get_unread_total` em 2º lugar.
 *
 * O contador só muda por TRÊS motivos, e cada um tem um gatilho aqui:
 *
 *   1. chegou mensagem de cliente  → realtime de `whatsapp_messages` (INSERT
 *      incoming), que o app JÁ assina — `useWhatsAppMessagesRealtime` (/chat e
 *      bolha) e `useChatBubbleContactsRealtime` (bolha). Nenhum canal novo.
 *   2. a pessoa leu / marcou como não lida → quem grava o read-state pede.
 *   3. o realtime falhou em silêncio (o `apply_rls()` de whatsapp_messages
 *      atrasa sob carga sem derrubar o canal) → fallback LENTO, ≥ 5 min, e
 *      refetch ao voltar o foco para a aba.
 *
 * ─── O TETO ─────────────────────────────────────────────────────────────────
 *
 * Rajada de mensagem não pode virar rajada de RPC. Uma org com 57 caixas
 * recebe dezenas de mensagens por minuto no pico; invalidar por mensagem seria
 * pior que o polling que este módulo substitui. Então os pedidos passam por um
 * throttle de borda dupla, UM por QueryClient (= um por aba):
 *
 *   - borda de ataque: o primeiro pedido depois de um período calmo dispara já
 *     (o ponto acende rápido quando a mensagem é isolada);
 *   - borda de fuga: pedidos dentro da janela colapsam num ÚNICO disparo ao
 *     fim dela (a última mensagem da rajada nunca fica de fora).
 *
 * Resultado: no máximo 1 releitura a cada `UNREAD_REFRESH_MIN_INTERVAL_MS` por
 * aba, venha de onde vier o pedido.
 *
 * ─── ABA EM SEGUNDO PLANO NÃO CONSULTA ──────────────────────────────────────
 *
 * Com a aba escondida o disparo só MARCA as queries como velhas
 * (`refetchType: "none"`). A releitura acontece quando a pessoa volta
 * (`refetchOnWindowFocus` nas duas queries). O fallback de 5 min também não
 * roda escondido — `refetchIntervalInBackground` fica no default `false`.
 */
import type { QueryClient } from "@tanstack/react-query";

/** Raiz da queryKey do badge global (`get_unread_total`). */
export const UNREAD_TOTAL_QUERY_ROOT = "unread-total-server";
/** Raiz da queryKey do ponto por caixa (`get_unread_counts`). */
export const NAO_LIDAS_POR_CAIXA_QUERY_ROOT = "nao_lidas_por_caixa";

/** Teto de vazão: no máximo uma releitura por aba a cada 20 s. */
export const UNREAD_REFRESH_MIN_INTERVAL_MS = 20_000;
/** Rede de segurança quando o realtime falha calado. Nunca abaixo de 5 min. */
export const UNREAD_FALLBACK_POLL_MS = 5 * 60_000;
/**
 * Frescor declarado das duas queries. Também limita o refetch de foco: trocar
 * de aba dez vezes em 30 s não gera dez RPCs.
 */
export const UNREAD_STALE_TIME_MS = 30_000;

export interface Relogio {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const relogioReal: Relogio = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export interface Throttle {
  /** Pede uma execução; colapsa com as demais dentro da janela. */
  request: () => void;
  /** Descarta a execução agendada, se houver. */
  cancel: () => void;
}

/**
 * Throttle de borda dupla (ataque + fuga) com no máximo UM timer vivo.
 *
 * Garantias, todas cobertas por teste:
 *   - duas execuções nunca ficam a menos de `intervaloMs` uma da outra;
 *   - todo pedido é atendido por uma execução que acontece DEPOIS dele;
 *   - N pedidos dentro de uma janela produzem no máximo 1 execução extra.
 */
export function criarThrottle(
  executar: () => void,
  intervaloMs: number,
  relogio: Relogio = relogioReal,
): Throttle {
  let ultima = Number.NEGATIVE_INFINITY;
  let agendado: unknown = null;

  const disparar = () => {
    agendado = null;
    ultima = relogio.now();
    executar();
  };

  return {
    request() {
      if (agendado !== null) return; // já existe uma execução que nos atende
      const espera = ultima + intervaloMs - relogio.now();
      if (espera <= 0) {
        disparar();
        return;
      }
      agendado = relogio.setTimeout(disparar, espera);
    },
    cancel() {
      if (agendado !== null) relogio.clearTimeout(agendado);
      agendado = null;
    },
  };
}

function abaEscondida(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** Invalida as duas contagens. Aba escondida: só marca como velhas. */
export function invalidarContagensDeNaoLidas(queryClient: QueryClient): void {
  const refetchType = abaEscondida() ? "none" : "active";
  for (const raiz of [UNREAD_TOTAL_QUERY_ROOT, NAO_LIDAS_POR_CAIXA_QUERY_ROOT]) {
    void queryClient.invalidateQueries({ queryKey: [raiz], refetchType });
  }
}

/**
 * Um throttle por QueryClient. WeakMap e não variável de módulo: em teste cada
 * caso cria o seu QueryClient, e um throttle global vazaria a janela de um
 * caso para o seguinte.
 */
const throttles = new WeakMap<QueryClient, Throttle>();

/**
 * Pede para as contagens de não-lidas serem relidas — respeitando o teto.
 *
 * É o caminho que todo gatilho AUTOMÁTICO deve usar — realtime e gravação de
 * read-state ao abrir conversa. Chamar `invalidateQueries` direto nas raízes
 * acima a partir desses gatilhos reabre a rajada que o incidente de 2026-10-02
 * fechou.
 *
 * Exceção conhecida e aceita: ação MANUAL e explícita de um clique, que a
 * pessoa espera ver refletida na hora — hoje "marcar como não lida"
 * (`handleMarkUnread` em `ChatShellWithContext.tsx`), que invalida direto.
 * Um clique não faz rajada; o teto existe para o que dispara sozinho.
 */
export function pedirAtualizacaoDeNaoLidas(queryClient: QueryClient): void {
  let throttle = throttles.get(queryClient);
  if (!throttle) {
    throttle = criarThrottle(
      () => invalidarContagensDeNaoLidas(queryClient),
      UNREAD_REFRESH_MIN_INTERVAL_MS,
    );
    throttles.set(queryClient, throttle);
  }
  throttle.request();
}
