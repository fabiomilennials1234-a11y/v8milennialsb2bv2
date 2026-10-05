/**
 * Saúde do canal realtime do chat → intervalo de reconciliação.
 *
 * `useReconcileInterval(perfil, org)` devolve a FUNÇÃO que vai em
 * `refetchInterval` do TanStack. Quem decide o número é `reconcilePolicy.ts`;
 * aqui só se traduz o estado do canal em "saudável" e "em fallback desde".
 *
 * Regras:
 *   - saudável = canal "joined". Todo o resto — inclusive "errored", que o
 *     `useRealtimeChannel` grava durante o backoff — é não saudável;
 *   - circuit breaker aberto (estado "polling") → fallback na hora;
 *   - outro estado não saudável por ≥ 10 s → fallback.
 *
 * Sem tick periódico. O antigo `setInterval` de 5 s re-renderizava todo
 * consumidor (bolha em toda tela incluída) mesmo com o canal saudável. Agora
 * o store avisa mudança por `useSyncExternalStore`, e um ÚNICO `setTimeout` é
 * agendado para o instante em que a carência de 10 s termina.
 */
import { useCallback, useEffect, useReducer } from "react";
import { useWhatsAppRealtimeStatus } from "@/shared/realtime/useRealtimeChannelStatus";
import type { ChannelStatus, RealtimeChannelState } from "@/lib/realtimeStatusStore";
import {
  intervaloDeReconciliacao,
  misturarSemente,
  type PerfilDeReconciliacao,
} from "./reconcilePolicy";

export const FALLBACK_THRESHOLD_MS = 10_000;

/**
 * Semente fixa desta aba. Sorteada UMA vez no carregamento do módulo — daí
 * em diante tudo é determinístico (ver `reconcilePolicy.ts`, "O JITTER").
 */
const SEMENTE_DA_ABA = Math.floor(Math.random() * 2 ** 32);

export function shouldFallback(
  state: RealtimeChannelState,
  circuitOpen: boolean,
  unhealthySince: number,
  now: number,
  thresholdMs: number = FALLBACK_THRESHOLD_MS,
): boolean {
  if (state === "joined") return false;
  if (circuitOpen || state === "polling") return true;
  return now - unhealthySince >= thresholdMs;
}

/** Instante em que o fallback começou, ou `null` se não está em fallback. */
function inicioDoFallback(status: ChannelStatus, now: number): number | null {
  if (status.state === "joined") return null;
  if (status.circuitOpen || status.state === "polling") return status.unhealthySince;
  const vira = status.unhealthySince + FALLBACK_THRESHOLD_MS;
  return now >= vira ? vira : null;
}

/**
 * Estado do canal + início do fallback, re-renderizando no fim da carência.
 * Nenhum timer vive enquanto o canal está saudável ou já em fallback.
 */
function useEstadoDoCanal(organizationId: string | null | undefined) {
  const status = useWhatsAppRealtimeStatus(organizationId);
  const [, forcarRender] = useReducer((n: number) => n + 1, 0);
  const desde = organizationId ? inicioDoFallback(status, Date.now()) : null;
  const naCarencia = !!organizationId && status.state !== "joined" && desde === null;
  const fimDaCarencia = status.unhealthySince + FALLBACK_THRESHOLD_MS;

  useEffect(() => {
    if (!naCarencia) return;
    const id = setTimeout(forcarRender, Math.max(0, fimDaCarencia - Date.now()));
    return () => clearTimeout(id);
  }, [naCarencia, fimDaCarencia]);

  return { status, desde };
}

/**
 * O que o intervalo lê da query. Estrutural de propósito: `Query` sem genéricos
 * é `Query<unknown>`, e uma função que pede `Query<unknown>` não é atribuível a
 * `refetchInterval` de `useQuery<T>` (parâmetro é contravariante) — o overload
 * falha e a inferência de `data` da query inteira cai para `{}`.
 */
export type QueryComDataUpdatedAt = { state: { dataUpdatedAt: number } };

/**
 * `refetchInterval` do chat. A função depende só de `query.state.dataUpdatedAt`
 * e do estado do canal: dois renders entre os mesmos dois fetches devolvem o
 * MESMO número — o TanStack reinicia o timer quando o valor muda.
 */
export function useReconcileInterval(
  perfil: PerfilDeReconciliacao,
  organizationId: string | null | undefined,
): (query: QueryComDataUpdatedAt) => number {
  const { status, desde } = useEstadoDoCanal(organizationId);
  const saudavel = status.state === "joined";

  return useCallback(
    (query: QueryComDataUpdatedAt) =>
      intervaloDeReconciliacao({
        perfil,
        saudavel,
        emFallbackDesdeMs: desde,
        agoraMs: Date.now(),
        semente: misturarSemente(SEMENTE_DA_ABA, query.state.dataUpdatedAt),
      }),
    [perfil, saudavel, desde],
  );
}

export type FallbackMode = "realtime" | "polling" | "connecting" | "offline";

export type FallbackResult = {
  shouldPoll: boolean;
  mode: FallbackMode;
  reason: string | null;
};

/** Leitura do estado do canal para UI/diagnóstico. Não decide intervalo. */
export function useWhatsAppRealtimeFallback(
  organizationId: string | null | undefined,
): FallbackResult {
  const { status, desde } = useEstadoDoCanal(organizationId);

  if (!organizationId) {
    return { shouldPoll: false, mode: "offline", reason: null };
  }

  const poll = desde !== null;

  let mode: FallbackMode;
  if (status.state === "joined") mode = "realtime";
  else if (poll) mode = "polling";
  else if (
    status.state === "joining" ||
    status.state === "reconnecting" ||
    status.state === "errored"
  )
    mode = "connecting";
  else mode = "offline";

  return { shouldPoll: poll, mode, reason: status.lastReason };
}
