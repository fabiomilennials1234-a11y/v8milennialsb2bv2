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
  reconnectCount: number;
  consecutiveFailures: number;
  circuitOpen: boolean;
  lastReason: string | null;
  diagnostics: DiagnosticEvent[];
};

const initialStatus = (): ChannelStatus => ({
  state: "unknown",
  lastEventAt: null,
  lastTransitionAt: Date.now(),
  reconnectCount: 0,
  consecutiveFailures: 0,
  circuitOpen: false,
  lastReason: null,
  diagnostics: [],
});

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
  if (prev.state === state && !reason) return;
  const next: ChannelStatus = {
    ...prev,
    state,
    lastTransitionAt: Date.now(),
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
