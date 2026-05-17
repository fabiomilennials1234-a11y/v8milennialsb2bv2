import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChannelState = "idle" | "joining" | "joined" | "errored" | "polling";

export interface DiagnosticEvent {
  timestamp: number;
  state: ChannelState;
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
  const { table, filter, onEvent, circuitBreaker, enabled = true } = options;

  const threshold = circuitBreaker?.threshold ?? DEFAULT_THRESHOLD;
  const cooldownMs = circuitBreaker?.cooldownMs ?? DEFAULT_COOLDOWN_MS;

  const [state, setState] = useState<ChannelState>(enabled ? "joining" : "idle");
  const [diagnostics, setDiagnostics] = useState<DiagnosticEvent[]>([]);

  const failureCountRef = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // reconnectEpoch — increment to force re-subscribe via useEffect dependency
  const [reconnectEpoch, setReconnectEpoch] = useState(0);

  // Track state in ref for event listeners (avoids stale closure)
  const stateRef = useRef<ChannelState>(state);
  stateRef.current = state;

  // Track circuit open state
  const circuitOpenRef = useRef(false);

  // Timer refs for cleanup
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dedupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dedupPendingRef = useRef(false);

  const pushDiagnostic = useCallback(
    (newState: ChannelState, error?: string) => {
      setDiagnostics((prev) => {
        const entry: DiagnosticEvent = {
          timestamp: Date.now(),
          state: newState,
          ...(error && { error }),
        };
        const next = [...prev, entry];
        return next.length > MAX_DIAGNOSTICS ? next.slice(-MAX_DIAGNOSTICS) : next;
      });
    },
    []
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

    setState("joining");

    const channelName = `rt_${table}_${filter ?? "all"}_${Date.now()}`;

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
        if (status === "SUBSCRIBED") {
          failureCountRef.current = 0;
          circuitOpenRef.current = false;
          setState("joined");
          stateRef.current = "joined";
          pushDiagnostic("joined");

          // Clear any pending timers since we're healthy
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

          if (circuitOpenRef.current || failureCountRef.current >= threshold) {
            // Circuit is open (or just tripped)
            circuitOpenRef.current = true;
            setState("polling");
            stateRef.current = "polling";
            pushDiagnostic("polling", errorMsg);
            // Schedule cooldown probe
            scheduleCooldownProbe();
          } else {
            setState("errored");
            stateRef.current = "errored";
            pushDiagnostic("errored", errorMsg);
            // Schedule exponential backoff reconnect
            scheduleBackoff(failureCountRef.current);
          }
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter, enabled, threshold, cooldownMs, reconnectEpoch]);

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
