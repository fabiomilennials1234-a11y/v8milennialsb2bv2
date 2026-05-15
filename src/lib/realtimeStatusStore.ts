/**
 * realtimeStatusStore — module-level pub/sub for Supabase Realtime channel health.
 *
 * Realtime hooks publish their channel state here; UI consumers subscribe via
 * `useRealtimeChannelStatus(channelName)` (built on `useSyncExternalStore`) and
 * render a status badge.
 *
 * Why module-level vs Context: the existing useWhatsAppMessagesRealtime hook
 * is called from 4+ places with the same channel name (per organization). A
 * Context provider would require wrapping every entry point. A singleton
 * store keeps every channel observable without touching the component tree.
 */

export type RealtimeChannelState =
  | "joining"     // subscribe() called, waiting for first ACK
  | "joined"      // SUBSCRIBED status received from Supabase
  | "stale"       // joined but no event/heartbeat in WINDOW
  | "reconnecting"
  | "offline"     // channel error / closed
  | "unknown";

export type ChannelStatus = {
  state: RealtimeChannelState;
  lastEventAt: number | null;
  lastTransitionAt: number;
  reconnectCount: number;
};

const initialStatus = (): ChannelStatus => ({
  state: "unknown",
  lastEventAt: null,
  lastTransitionAt: Date.now(),
  reconnectCount: 0,
});

const channels = new Map<string, ChannelStatus>();
const listeners = new Map<string, Set<() => void>>();

function emit(name: string) {
  const ls = listeners.get(name);
  if (!ls) return;
  for (const fn of ls) fn();
}

export function setChannelState(name: string, state: RealtimeChannelState): void {
  const prev = channels.get(name) ?? initialStatus();
  if (prev.state === state) return;
  const next: ChannelStatus = {
    ...prev,
    state,
    lastTransitionAt: Date.now(),
    reconnectCount: state === "reconnecting" ? prev.reconnectCount + 1 : prev.reconnectCount,
  };
  channels.set(name, next);
  emit(name);
}

export function recordChannelEvent(name: string): void {
  const prev = channels.get(name) ?? initialStatus();
  const next: ChannelStatus = { ...prev, lastEventAt: Date.now() };
  channels.set(name, next);
  emit(name);
}

export function getChannelStatus(name: string): ChannelStatus {
  return channels.get(name) ?? initialStatus();
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
