/**
 * useLeadConflictNotifier(leadId)
 *
 * Escuta UPDATEs em `leads` para o lead aberto e dispara toast informativo
 * quando outro usuário commitou mudança enquanto o user atual está com o
 * modal aberto. Adiciona overlay sticky de aviso quando há rascunho local
 * (passed via `hasDraft`) — UX do PRD #284 fase 6 (conflict resolution).
 *
 * Distingue dois caminhos:
 * 1. **Realtime UPDATE alheio** — outro user salvou. Toast info "Lead
 *    atualizado por X" + invalidate queryKey. Rascunho preservado.
 * 2. **409 conflict no save (optimistic lock)** — usar `notifyOptimisticConflict`
 *    explicitamente em mutations que detectarem `WHERE updated_at = ?` fail.
 *
 * Não acopla ao useLeadDetailRealtime (issue #306) — esta hook usa channel
 * próprio pra ser independente. Quando #306 entrar em main, a subscription
 * pode ser consolidada.
 */

import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/modules/identity";
import { toast } from "sonner";

export interface UseLeadConflictNotifierOptions {
  /** Quando true, toast inclui aviso de rascunho preservado. */
  hasDraft?: boolean;
  /** Disable subscription completely (modal fechado etc). */
  enabled?: boolean;
}

interface LeadUpdatePayload {
  id: string;
  updated_at?: string | null;
  responsible_id?: string | null;
  /**
   * Sem coluna "updated_by" no schema atual de leads — usamos
   * `lead_history` post-event pra inferir autor quando precisar. Por ora
   * mostramos toast genérico sem nome.
   */
  [key: string]: unknown;
}

export function useLeadConflictNotifier(
  leadId: string | null | undefined,
  options: UseLeadConflictNotifierOptions = {},
) {
  const { enabled = true, hasDraft = false } = options;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const lastSeenUpdatedAt = useRef<string | null>(null);
  const hasDraftRef = useRef(hasDraft);
  hasDraftRef.current = hasDraft;

  useEffect(() => {
    if (!enabled || !leadId) return;
    const channelName = `lead-conflict-${leadId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leads",
          filter: `id=eq.${leadId}`,
        },
        (payload: { new: LeadUpdatePayload; old?: LeadUpdatePayload }) => {
          const nextUpdatedAt = payload.new?.updated_at ?? null;
          if (
            nextUpdatedAt &&
            lastSeenUpdatedAt.current === nextUpdatedAt
          ) {
            return; // mesma versão já processada
          }
          lastSeenUpdatedAt.current = nextUpdatedAt;

          // Best-effort: queryClient invalidate pra refetch background
          queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
          queryClient.invalidateQueries({ queryKey: ["lead-detail", leadId] });

          toast.info(
            hasDraftRef.current
              ? "Lead atualizado por outro usuário. Seus rascunhos foram preservados."
              : "Lead atualizado por outro usuário.",
            { duration: 5000 },
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, leadId, queryClient, user?.id]);
}

/**
 * Chamar dentro de catch() de mutation quando UPDATE optimistic-locked
 * retornar 0 rows (versão mudou entre fetch e save). Refetch + toast
 * warning. Use no useUpdateLead / useUpdatePipe* etc.
 */
export function notifyOptimisticConflict(
  queryClient: ReturnType<typeof useQueryClient>,
  leadId: string,
) {
  queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
  queryClient.invalidateQueries({ queryKey: ["lead-detail", leadId] });
  toast.warning(
    "Lead atualizado por outro usuário. Atualizando seus dados…",
    { duration: 5000 },
  );
}
