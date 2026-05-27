/**
 * useMessageSearch — busca full-text em whatsapp_messages via RPC search_messages.
 *
 * C33: debounce 300ms, enabled com query >= 3 chars, cache 30s.
 * C21: rate limit token bucket client-side (20 req/min por usuário).
 *
 * Segurança:
 *   - RPC tem 4 guards: auth.uid() NOT NULL, org membership, query >= 3 chars, limit <= 100
 *   - headline retorna HTML com <mark> — NUNCA renderizar sem DOMPurify (B5 — vide C37)
 *   - Rate limit client-side: 20 tokens/min. Server-side em Onda 3.2.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as Sentry from "@sentry/react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useAuth } from "@/modules/identity";
import { createRateLimiter } from "@/lib/rate-limit";
import type { MessageSearchResult } from "@/modules/communication/lib/chat-types";

// ─── Constantes ────────────────────────────────────────────────────────────────

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 20;
const STALE_TIME_MS = 30_000;
const RATE_LIMIT_CAPACITY = 20;
const RATE_LIMIT_INTERVAL_MS = 60_000;

// ─── Hook ──────────────────────────────────────────────────────────────────────

interface UseMessageSearchResult {
  results: MessageSearchResult[];
  isLoading: boolean;
  error: Error | null;
  search: (query: string) => void;
  clear: () => void;
  activeQuery: string;
  rateLimited: boolean;
}

export function useMessageSearch(): UseMessageSearchResult {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [rawQuery, setRawQuery] = useState("");
  const [rateLimited, setRateLimited] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rate limiter — scoped por userId para isolamento entre usuários no mesmo device
  const limiter = useMemo(
    () =>
      createRateLimiter({
        key: `rl:search_messages:${user?.id ?? "anon"}`,
        capacity: RATE_LIMIT_CAPACITY,
        refillIntervalMs: RATE_LIMIT_INTERVAL_MS,
      }),
    [user?.id],
  );

  // Debounce input → só dispara query após DEBOUNCE_MS sem digitar
  const search = useCallback((query: string) => {
    setRawQuery(query);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, DEBOUNCE_MS);
  }, []);

  const clear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setRawQuery("");
    setDebouncedQuery("");
    setRateLimited(false);
  }, []);

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const enabled =
    !!organizationId &&
    debouncedQuery.length >= MIN_QUERY_LENGTH &&
    !rateLimited;

  const queryKey = ["search-messages", organizationId, debouncedQuery];

  const { data, isLoading, error } = useQuery<MessageSearchResult[]>({
    queryKey,
    queryFn: async () => {
      if (!organizationId || debouncedQuery.length < MIN_QUERY_LENGTH) return [];

      // Rate limit check — síncrono, antes de qualquer I/O
      const rl = limiter.tryConsume(1);
      if (!rl.allowed) {
        const retrySec = Math.ceil(rl.retryAfterMs / 1000);

        // Sentry breadcrumb — severity warning, não error (acidental, não adversarial)
        Sentry.addBreadcrumb({
          category: "rate_limit",
          message: "search_messages_rate_limited",
          level: "warning",
          data: {
            userId: user?.id,
            retryAfterMs: rl.retryAfterMs,
            tokensRemaining: rl.tokensRemaining,
          },
        });

        setRateLimited(true);
        throw new Error(`rate_limited:${retrySec}`);
      }

      const { data, error } = await supabase.rpc("search_messages", {
        p_org_id: organizationId,
        p_query: debouncedQuery,
        p_limit: RESULT_LIMIT,
        p_offset: 0,
      });

      if (error) throw new Error(error.message);

      // shape: { id, phone_number, message, direction, timestamp, headline }[]
      return (data ?? []) as MessageSearchResult[];
    },
    enabled,
    staleTime: STALE_TIME_MS,
    placeholderData: (prev) => prev,
  });

  // Tratar erro de rate limit — toast uma vez, não propagar como Sentry error
  useEffect(() => {
    if (!error) return;
    const msg = error.message;
    if (msg.startsWith("rate_limited:")) {
      const sec = msg.split(":")[1] ?? "60";
      toast.error(`Muitas buscas. Aguarde ${sec}s antes de continuar.`, {
        id: "search-rate-limited", // dedup — só exibe um toast por período
      });
    }
  }, [error]);

  // Reset do flag quando query muda (usuário pode tentar novamente após refill)
  useEffect(() => {
    if (debouncedQuery.length < MIN_QUERY_LENGTH) {
      setRateLimited(false);
    }
  }, [debouncedQuery]);

  void qc; // usado implicitamente pelo useQuery cache

  return {
    results: data ?? [],
    isLoading: enabled && isLoading,
    error: error instanceof Error && !error.message.startsWith("rate_limited:") ? error : null,
    search,
    clear,
    activeQuery: debouncedQuery,
    rateLimited,
  };
}
