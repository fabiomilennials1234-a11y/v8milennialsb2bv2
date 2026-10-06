import { useEffect, useRef, useState, useCallback } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import {
  acquireRealtimeChannel,
  type ChannelHandle,
  type ChannelTransition,
} from "./realtimeChannelRegistry";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChannelState = "idle" | "joining" | "joined" | "errored" | "polling";

export interface DiagnosticEvent {
  timestamp: number;
  channelName: string;
  table: string;
  oldState: ChannelState;
  newState: ChannelState;
  failureCount: number;
  type?: "circuit_open" | "circuit_close" | "transition";
  error?: string;
}

/**
 * Uma transição do canal vista por ESTA instância, entregue na hora (sem
 * esperar render) e na ordem exata em relação aos eventos.
 */
export interface ChannelStateChange {
  state: Exclude<ChannelState, "idle">;
  /** Falhas seguidas do canal; zera no SUBSCRIBED. `joining` com falhas = voltando de queda. */
  failureCount: number;
  /**
   * Primeira transição depois de entrar no canal (montagem, troca de chave,
   * religar): o estado em que esta instância ENCONTROU o canal compartilhado —
   * `joined` se outra instância já o tinha aberto.
   */
  initial: boolean;
}

export interface UseRealtimeChannelOptions {
  table: string;
  filter?: string;
  onEvent: (payload: RealtimePostgresChangesPayload<any>) => void;
  /** Lido por ref: trocar a função a cada render não reabre o canal. */
  onStateChange?: (change: ChannelStateChange) => void;
  circuitBreaker?: {
    threshold?: number;   // default: 5
    cooldownMs?: number;  // default: 120_000
  };
  enabled?: boolean;      // default: true
  statusKey?: string;     // stable key for realtimeStatusStore (default: `rt_{table}_{filter}`, shared)
}

export interface UseRealtimeChannelResult {
  state: ChannelState;
  diagnostics: DiagnosticEvent[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 120_000;
const MAX_DIAGNOSTICS = 50;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Assina `postgres_changes` de uma tabela (com filtro opcional).
 *
 * O canal é COMPARTILHADO por (tabela, filtro, evento) dentro da aba — ver
 * `realtimeChannelRegistry.ts`. N hooks com a mesma chave = 1 assinatura no
 * servidor; cada hook recebe todos os eventos e espelha o estado do canal
 * (`state`, `diagnostics`). O último a desmontar fecha o canal.
 *
 * `state` é o do RENDER: entrar num canal já `joined` vindo de outro `joined`
 * (troca de chave) não muda o valor e não re-renderiza. Quem precisa de cada
 * transição — inclusive a de entrada — usa `onStateChange`.
 */
export function useRealtimeChannel(
  options: UseRealtimeChannelOptions
): UseRealtimeChannelResult {
  const { table, filter, onEvent, circuitBreaker, enabled = true, statusKey } = options;

  const threshold = circuitBreaker?.threshold ?? DEFAULT_THRESHOLD;
  const cooldownMs = circuitBreaker?.cooldownMs ?? DEFAULT_COOLDOWN_MS;

  const [state, setState] = useState<ChannelState>("idle");
  const [diagnostics, setDiagnostics] = useState<DiagnosticEvent[]>([]);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onStateChangeRef = useRef(options.onStateChange);
  onStateChangeRef.current = options.onStateChange;

  // Track state in ref for event listeners (avoids stale closure)
  const stateRef = useRef<ChannelState>(state);
  stateRef.current = state;

  const handleRef = useRef<ChannelHandle | null>(null);

  const applyTransition = useCallback(
    (t: ChannelTransition) => {
      const oldState = stateRef.current;
      setDiagnostics((prev) => {
        const entry: DiagnosticEvent = {
          timestamp: Date.now(),
          channelName: t.channelName,
          table,
          oldState,
          newState: t.state,
          failureCount: t.failureCount,
          type: t.type,
          ...(t.error && { error: t.error }),
        };
        const next = [...prev, entry];
        return next.length > MAX_DIAGNOSTICS ? next.slice(-MAX_DIAGNOSTICS) : next;
      });
      stateRef.current = t.state;
      setState(t.state);
    },
    [table]
  );

  // ─── Main subscribe effect ────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled) {
      stateRef.current = "idle";
      setState("idle");
      return;
    }

    // A 1ª transição chega DENTRO do acquire (canal novo: "joining"; canal já
    // aberto por outra instância: o estado dele) — por isso a marca é local.
    let initial = true;
    const handle = acquireRealtimeChannel(
      { table, filter, event: "*", threshold, cooldownMs },
      {
        statusKey,
        onEvent: (payload) => onEventRef.current(payload),
        onTransition: (t) => {
          applyTransition(t);
          const first = initial;
          initial = false;
          onStateChangeRef.current?.({ state: t.state, failureCount: t.failureCount, initial: first });
        },
      }
    );
    handleRef.current = handle;

    return () => {
      handleRef.current = null;
      handle.release();
    };
  }, [table, filter, enabled, threshold, cooldownMs, statusKey, applyTransition]);

  // ─── Visibility + Online reconnect effect ─────────────────────────────────

  useEffect(() => {
    if (!enabled) return;

    const unhealthy = () => stateRef.current !== "joined" && stateRef.current !== "idle";

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && unhealthy()) {
        handleRef.current?.requestReconnect();
      }
    };

    const handleOnline = () => {
      if (unhealthy()) handleRef.current?.requestReconnect();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [enabled]);

  return { state, diagnostics };
}
