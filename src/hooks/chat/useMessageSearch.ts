/**
 * useMessageSearch — busca full-text em whatsapp_messages via RPC search_messages.
 *
 * C33: debounce 300ms, enabled com query >= 3 chars, cache 30s.
 *
 * Segurança:
 *   - RPC tem 4 guards: auth.uid() NOT NULL, org membership, query >= 3 chars, limit <= 100
 *   - headline retorna HTML com <mark> — NUNCA renderizar sem DOMPurify (B5 — vide C37)
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import type { MessageSearchResult } from "@/lib/chat-types";

// ─── Constantes ────────────────────────────────────────────────────────────────

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 20;
const STALE_TIME_MS = 30_000;

// ─── Hook ──────────────────────────────────────────────────────────────────────

interface UseMessageSearchResult {
  results: MessageSearchResult[];
  isLoading: boolean;
  error: Error | null;
  search: (query: string) => void;
  clear: () => void;
  activeQuery: string;
}

export function useMessageSearch(): UseMessageSearchResult {
  const { organizationId } = useOrganization();
  const qc = useQueryClient();
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [rawQuery, setRawQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const enabled =
    !!organizationId &&
    debouncedQuery.length >= MIN_QUERY_LENGTH;

  const queryKey = ["search-messages", organizationId, debouncedQuery];

  const { data, isLoading, error } = useQuery<MessageSearchResult[]>({
    queryKey,
    queryFn: async () => {
      if (!organizationId || debouncedQuery.length < MIN_QUERY_LENGTH) return [];

      const { data, error } = await supabase.rpc("search_messages", {
        p_org_id:  organizationId,
        p_query:   debouncedQuery,
        p_limit:   RESULT_LIMIT,
        p_offset:  0,
      });

      if (error) throw new Error(error.message);

      // shape: { id, phone_number, message, direction, timestamp, headline }[]
      return (data ?? []) as MessageSearchResult[];
    },
    enabled,
    staleTime: STALE_TIME_MS,
    placeholderData: (prev) => prev,
  });

  return {
    results: data ?? [],
    isLoading: enabled && isLoading,
    error: error as Error | null,
    search,
    clear,
    activeQuery: debouncedQuery,
  };
}
