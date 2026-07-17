import { useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeOrgId } from "./realtime-org-context";
import { useRealtimeChannel } from "./useRealtimeChannel";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

/**
 * Debounce de 2 segundos para evitar cascade de invalidações
 * quando múltiplas mudanças chegam em sequência (ex: bulk update de leads)
 */
const DEBOUNCE_MS = 2000;

/**
 * Tabelas que NÃO têm coluna organization_id — usam wildcard.
 * Todas as outras são filtradas por org_id para reduzir ~80% do tráfego realtime.
 */
const TABLES_WITHOUT_ORG_ID = new Set([
  "team_members",
  "user_roles",
  "profiles",
  "master_users",
  "tags",
  "checklist_items",
  // blast_plan_recipients carries no organization_id (tenancy via plan_id →
  // blast_plans); subscribe without the org filter (#910 live blast feed).
  "blast_plan_recipients",
  // Tabelas na publication supabase_realtime que NÃO têm coluna
  // organization_id — filtrar por ela gera "invalid column for filter
  // organization_id" e derruba o canal (degrada o pool de Realtime).
  // A RLS (apply_rls) já gate os eventos por org; a invalidação por queryKey
  // re-busca com escopo no servidor. (schema drift fix 2026-07-17)
  "acoes_do_dia",
  "campanha_leads",
  "feature_permissions",
  "lead_scores",
  "pipe_proposta_items",
  "support_ticket_comments",
  "upsell_client_products",
]);

export interface RealtimeHandlers<T = any> {
  /**
   * Called on UPDATE events. Receives the updated record (flat, no joins)
   * and the current cached data. Return the new cache value.
   * When provided, avoids full invalidation for updates.
   */
  onUpdate?: (updatedRecord: T, oldData: T[]) => T[];
  /**
   * Called on DELETE events. Receives the old record and current cached data.
   * Return the new cache value.
   */
  onDelete?: (deletedRecord: T, oldData: T[]) => T[];
}

export function useRealtimeSubscription<T = any>(
  table: string,
  queryKeys: string[],
  handlers?: RealtimeHandlers<T>
) {
  const queryClient = useQueryClient();
  const organizationId = useRealtimeOrgId();

  const queryKeysRef = useRef(queryKeys);
  queryKeysRef.current = queryKeys;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staggerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRealtimeEvent = useCallback(
    (payload: RealtimePostgresChangesPayload<any>) => {
      const keys = queryKeysRef.current;
      const currentHandlers = handlersRef.current;
      const eventType = payload.eventType;

      // Surgical update: UPDATE with handler
      if (eventType === "UPDATE" && currentHandlers?.onUpdate && keys.length > 0) {
        const updatedRecord = payload.new;
        queryClient.setQueriesData(
          { queryKey: [keys[0]] },
          (oldData: any) => {
            if (!Array.isArray(oldData)) return oldData;
            return currentHandlers.onUpdate!(updatedRecord as T, oldData);
          }
        );
        return;
      }

      // Surgical delete: DELETE with handler
      if (eventType === "DELETE" && currentHandlers?.onDelete && keys.length > 0) {
        const deletedRecord = payload.old;
        queryClient.setQueriesData(
          { queryKey: [keys[0]] },
          (oldData: any) => {
            if (!Array.isArray(oldData)) return oldData;
            return currentHandlers.onDelete!(deletedRecord as T, oldData);
          }
        );
        return;
      }

      // Fallback: debounced invalidation (INSERT or no handler provided)
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        if (keys.length > 0) {
          queryClient.invalidateQueries({ queryKey: [keys[0]], refetchType: "active" });

          if (keys.length > 1) {
            if (staggerTimerRef.current) {
              clearTimeout(staggerTimerRef.current);
            }
            staggerTimerRef.current = setTimeout(() => {
              keys.slice(1).forEach((key) => {
                queryClient.invalidateQueries({ queryKey: [key], refetchType: "active" });
              });
              staggerTimerRef.current = null;
            }, DEBOUNCE_MS);
          }
        }
        debounceTimerRef.current = null;
      }, DEBOUNCE_MS);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient]
  );

  // Compute filter — org-based for most tables, none for TABLES_WITHOUT_ORG_ID
  const canFilter = !TABLES_WITHOUT_ORG_ID.has(table) && !!organizationId;
  const filter = canFilter ? `organization_id=eq.${organizationId}` : undefined;

  useRealtimeChannel({
    table,
    filter,
    onEvent: handleRealtimeEvent,
    enabled: true,
  });
}
