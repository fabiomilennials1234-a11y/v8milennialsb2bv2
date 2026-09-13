export type ChatPresenceState = 'composing' | 'available';

/** Bound request frequency and coalesce pending updates while the transport is busy. */
export function createTypingPresence(send: (state: ChatPresenceState) => Promise<void>) {
  let active = false;
  let disposed = false;
  let lastRefresh = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: ChatPresenceState | undefined;
  let running = false;
  const drain = async () => {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const state = pending;
        pending = undefined;
        try { await send(state); } catch { /* Presence is advisory; sending messages remains available. */ }
      }
    } finally { running = false; }
  };
  const emit = (state: ChatPresenceState) => { pending = state; void drain(); };
  const stop = () => {
    clearTimeout(timer);
    if (!active) return;
    active = false;
    emit('available');
  };
  return {
    typing() {
      if (disposed) return;
      const now = Date.now();
      if (!active || now - lastRefresh >= 8000) {
        active = true;
        lastRefresh = now;
        emit('composing');
      }
      clearTimeout(timer);
      timer = setTimeout(stop, 3000);
    },
    stop,
    dispose() { disposed = true; stop(); },
  };
}
