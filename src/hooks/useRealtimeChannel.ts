import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import {
  setChannelState,
  incrementFailures,
  resetFailures,
  openCircuitBreaker,
} from "@/lib/realtimeStatusStore";

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

export interface UseRealtimeChannelOptions {
  table: string;
  filter?: string;
  onEvent: (payload: RealtimePostgresChangesPayload<any>) => void;
  circuitBreaker?: {
    threshold?: number;   // default: 5
    cooldownMs?: number;  // default: 120_000
  };
  enabled?: boolean;      // default: true
  statusKey?: string;     // stable key for realtimeStatusStore (defaults to channel name)
}

export interface UseRealtimeChannelResult {
  state: ChannelState;
  diagnostics: DiagnosticEvent[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 120_000;
const MAX_DIAGNOSTICS = 50;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const DEDUP_WINDOW_MS = 1_000;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRealtimeChannel(
  options: UseRealtimeChannelOptions
): UseRealtimeChannelResult {
  const { table, filter, onEvent, circuitBreaker, enabled = true, statusKey } = options;

  const threshold = circuitBreaker?.threshold ?? DEFAULT_THRESHOLD;
  const cooldownMs = circuitBreaker?.cooldownMs ?? DEFAULT_COOLDOWN_MS;

  const [state, setState] = useState<ChannelState>("idle");
  const [diagnostics, setDiagnostics] = useState<DiagnosticEvent[]>([]);

  const failureCountRef = useRef(0);
  const channelNameRef = useRef("");
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // reconnectEpoch — increment to force re-subscribe via useEffect dependency
  const [reconnectEpoch, setReconnectEpoch] = useState(0);

  // Track state in ref for event listeners (avoids stale closure)
  const stateRef = useRef<ChannelState>(state);
  stateRef.current = state;

  // Track circuit open state
  const circuitOpenRef = useRef(false);

  // Stable key for status store (falls back to channel name)
  const statusKeyRef = useRef(statusKey);

  // Timer refs for cleanup
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dedupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dedupPendingRef = useRef(false);

  const pushDiagnostic = useCallback(
    (newState: ChannelState, opts?: { error?: string; type?: DiagnosticEvent["type"] }) => {
      const oldState = stateRef.current;
      setDiagnostics((prev) => {
        const entry: DiagnosticEvent = {
          timestamp: Date.now(),
          channelName: channelNameRef.current,
          table,
          oldState,
          newState,
          failureCount: failureCountRef.current,
          type: opts?.type ?? "transition",
          ...(opts?.error && { error: opts.error }),
        };
        const next = [...prev, entry];
        return next.length > MAX_DIAGNOSTICS ? next.slice(-MAX_DIAGNOSTICS) : next;
      });
    },
    [table]
  );

  // ─── Backoff calculator ───────────────────────────────────────────────────

  const getBackoffDelay = useCallback((failures: number): number => {
    return Math.min(BASE_BACKOFF_MS * Math.pow(2, failures - 1), MAX_BACKOFF_MS);
  }, []);

  // ─── Trigger reconnect (deduped) ─────────────────────────────────────────

  const triggerReconnect = useCallback(() => {
    if (dedupPendingRef.current) return;
    dedupPendingRef.current = true;

    if (dedupTimerRef.current) clearTimeout(dedupTimerRef.current);
    dedupTimerRef.current = setTimeout(() => {
      dedupPendingRef.current = false;
      dedupTimerRef.current = null;
      setReconnectEpoch((e) => e + 1);
    }, DEDUP_WINDOW_MS);
  }, []);

  // ─── Schedule backoff reconnect ───────────────────────────────────────────

  const scheduleBackoff = useCallback(
    (failures: number) => {
      if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
      const delay = getBackoffDelay(failures);
      backoffTimerRef.current = setTimeout(() => {
        backoffTimerRef.current = null;
        setReconnectEpoch((e) => e + 1);
      }, delay);
    },
    [getBackoffDelay]
  );

  // ─── Schedule cooldown probe ──────────────────────────────────────────────

  const scheduleCooldownProbe = useCallback(() => {
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => {
      cooldownTimerRef.current = null;
      // Attempt probe reconnect
      setReconnectEpoch((e) => e + 1);
    }, cooldownMs);
  }, [cooldownMs]);

  // ─── Main subscribe effect ────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled) {
      setState("idle");
      return;
    }

    const channelName = `rt_${table}_${filter ?? "all"}_${Date.now()}`;
    channelNameRef.current = channelName;
    statusKeyRef.current = statusKey;
    const storeKey = statusKey ?? channelName;

    setChannelState(storeKey, "joining", undefined);
    pushDiagnostic("joining");
    stateRef.current = "joining";
    setState("joining");

    const pgChangesConfig: Record<string, string> = {
      event: "*",
      schema: "public",
      table,
    };

    if (filter) {
      pgChangesConfig.filter = filter;
    }

    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", pgChangesConfig as any, (payload: any) => {
        onEventRef.current(payload);
      })
      .subscribe((status: string, err?: Error) => {
        const sk = statusKeyRef.current ?? channelNameRef.current;

        if (status === "SUBSCRIBED") {
          const wasPolling = stateRef.current === "polling";
          failureCountRef.current = 0;
          circuitOpenRef.current = false;

          resetFailures(sk);
          setChannelState(sk, "joined", undefined);

          if (wasPolling) {
            pushDiagnostic("joined", { type: "circuit_close" });
          } else {
            pushDiagnostic("joined");
          }
          setState("joined");
          stateRef.current = "joined";

          if (backoffTimerRef.current) {
            clearTimeout(backoffTimerRef.current);
            backoffTimerRef.current = null;
          }
          if (cooldownTimerRef.current) {
            clearTimeout(cooldownTimerRef.current);
            cooldownTimerRef.current = null;
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          const errorMsg = err?.message ?? status;
          failureCountRef.current += 1;

          incrementFailures(sk, errorMsg);

          if (circuitOpenRef.current || failureCountRef.current >= threshold) {
            circuitOpenRef.current = true;
            openCircuitBreaker(sk, errorMsg);
            setChannelState(sk, "polling", errorMsg);
            pushDiagnostic("polling", { error: errorMsg, type: "circuit_open" });
            setState("polling");
            stateRef.current = "polling";
            scheduleCooldownProbe();
          } else {
            setChannelState(sk, "errored", errorMsg);
            pushDiagnostic("errored", { error: errorMsg });
            setState("errored");
            stateRef.current = "errored";
            scheduleBackoff(failureCountRef.current);
          }
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter, enabled, threshold, cooldownMs, reconnectEpoch, statusKey]);

  // ─── Visibility + Online reconnect effect ─────────────────────────────────

  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        stateRef.current !== "joined" &&
        stateRef.current !== "idle"
      ) {
        triggerReconnect();
      }
    };

    const handleOnline = () => {
      if (stateRef.current !== "joined" && stateRef.current !== "idle") {
        triggerReconnect();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [enabled, triggerReconnect]);

  // ─── Cleanup all timers on unmount ────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      if (dedupTimerRef.current) clearTimeout(dedupTimerRef.current);
    };
  }, []);

  return { state, diagnostics };
}
