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

  useEffect(() => {
    if (!enabled) {
      setState("idle");
      return;
    }

    setState("joining");
    failureCountRef.current = 0;

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
          setState("joined");
          pushDiagnostic("joined");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          const errorMsg = err?.message ?? status;
          failureCountRef.current += 1;

          if (failureCountRef.current >= threshold) {
            setState("polling");
            pushDiagnostic("polling", errorMsg);
          } else {
            setState("errored");
            pushDiagnostic("errored", errorMsg);
          }
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter, enabled, threshold, cooldownMs]);

  return { state, diagnostics };
}
