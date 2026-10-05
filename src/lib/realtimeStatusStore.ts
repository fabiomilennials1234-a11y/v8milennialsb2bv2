/**
 * realtimeStatusStore — module-level pub/sub for Supabase Realtime channel health.
 *
 * Three layers:
 *   1. Transport state (joining → joined → offline → reconnecting)
 *   2. Circuit breaker (N failures → polling mode → cooldown probe)
 *   3. Diagnostics (event log with reasons, timestamps, failure counts)
 *
 * UI consumers subscribe via `useRealtimeChannelStatus(channelName)` (useSyncExternalStore).
 */

export type RealtimeChannelState =
  | "joining"
  | "joined"
  | "reconnecting"
  | "errored"       // CHANNEL_ERROR/TIMED_OUT abaixo do limiar do breaker — em backoff
  | "polling"       // circuit breaker tripped — polling is primary
  | "offline"
  | "unknown";

export type DiagnosticEvent = {
  timestamp: number;
  type: string;
  reason: string;
};

const MAX_DIAGNOSTICS = 30;

export type ChannelStatus = {
  state: RealtimeChannelState;
  lastEventAt: number | null;
  lastTransitionAt: number;
  /**
   * Desde quando o canal está fora de "joined". Diferente de
   * `lastTransitionAt`, NÃO reinicia entre estados não saudáveis (o backoff
   * alterna errored ↔ joining a cada tentativa). É o relógio dos degraus de
   * fallback em `reconcilePolicy.ts`. Sem significado enquanto "joined".
   */
  unhealthySince: number;
  /**
   * Quantas vezes o canal entrou em "joined" — inclusive "joined" repetido.
   * Subir além de 1 = reconexão: eventos da queda se perderam. Assinado por
   * `useWhatsAppMessagesRealtime` → `chatReconcile.ts`.
   */
  joinCount: number;
  reconnectCount: number;
  consecutiveFailures: number;
  circuitOpen: boolean;
  lastReason: string | null;
  diagnostics: DiagnosticEvent[];
};

const initialStatus = (): ChannelStatus => {
  const agora = Date.now();
  return {
    state: "unknown",
    lastEventAt: null,
    lastTransitionAt: agora,
    unhealthySince: agora,
    joinCount: 0,
    reconnectCount: 0,
    consecutiveFailures: 0,
    circuitOpen: false,
    lastReason: null,
    diagnostics: [],
  };
};

const channels = new Map<string, ChannelStatus>();
const listeners = new Map<string, Set<() => void>>();

function getOrInitStatus(name: string): ChannelStatus {
  let st = channels.get(name);
  if (!st) {
    st = initialStatus();
    channels.set(name, st);
  }
  return st;
}

function emit(name: string) {
  const ls = listeners.get(name);
  if (!ls) return;
  for (const fn of ls) fn();
}

function appendDiag(prev: DiagnosticEvent[], type: string, reason: string): DiagnosticEvent[] {
  const next = [...prev, { timestamp: Date.now(), type, reason }];
  return next.length > MAX_DIAGNOSTICS ? next.slice(-MAX_DIAGNOSTICS) : next;
}

export function setChannelState(
  name: string,
  state: RealtimeChannelState,
  reason?: string,
): void {
  const prev = getOrInitStatus(name);
  if (prev.state === state && !reason) {
    // "joined" repetido é uma RECONEXÃO, não ruído: conta e avisa.
    if (state !== "joined") return;
    channels.set(name, { ...prev, joinCount: prev.joinCount + 1 });
    emit(name);
    return;
  }
  const agora = Date.now();
  const next: ChannelStatus = {
    ...prev,
    state,
    lastTransitionAt: agora,
    unhealthySince:
      prev.state === "joined" && state !== "joined" ? agora : prev.unhealthySince,
    joinCount: state === "joined" ? prev.joinCount + 1 : prev.joinCount,
    reconnectCount:
      state === "reconnecting" ? prev.reconnectCount + 1 : prev.reconnectCount,
    lastReason: reason ?? prev.lastReason,
    diagnostics: appendDiag(prev.diagnostics, `state:${state}`, reason ?? ""),
  };
  channels.set(name, next);
  emit(name);
}

export function recordChannelEvent(name: string): void {
  const prev = getOrInitStatus(name);
  const next: ChannelStatus = { ...prev, lastEventAt: Date.now() };
  channels.set(name, next);
  emit(name);
}

export function incrementFailures(name: string, reason: string): number {
  const prev = getOrInitStatus(name);
  const failures = prev.consecutiveFailures + 1;
  channels.set(name, {
    ...prev,
    consecutiveFailures: failures,
    lastReason: reason,
    diagnostics: appendDiag(prev.diagnostics, "failure", `#${failures}: ${reason}`),
  });
  emit(name);
  return failures;
}

export function resetFailures(name: string): void {
  const prev = getOrInitStatus(name);
  if (prev.consecutiveFailures === 0 && !prev.circuitOpen) return;
  channels.set(name, {
    ...prev,
    consecutiveFailures: 0,
    circuitOpen: false,
    diagnostics: prev.circuitOpen
      ? appendDiag(prev.diagnostics, "circuit_close", "connected")
      : prev.diagnostics,
  });
  emit(name);
}

export function openCircuitBreaker(name: string, reason: string): void {
  const prev = getOrInitStatus(name);
  if (prev.circuitOpen) return;
  channels.set(name, {
    ...prev,
    circuitOpen: true,
    diagnostics: appendDiag(prev.diagnostics, "circuit_open", reason),
  });
  emit(name);
}

export function getChannelStatus(name: string): ChannelStatus {
  return getOrInitStatus(name);
}

export function subscribeChannelStatus(name: string, fn: () => void): () => void {
  let set = listeners.get(name);
  if (!set) {
    set = new Set();
    listeners.set(name, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(name);
  };
}
