/**
 * useCopilotToggleRealtime — subscription única em phone_ai_preferences.
 *
 * Onda 2 U3 (2026-04-26): quando user A toggla, user B (mesma org, qualquer
 * tela) vê o estado novo em <1s sem refetch manual.
 *
 * Funcionamento:
 *   - Subscribe `postgres_changes` em phone_ai_preferences filtrado por
 *     organization_id da org atual.
 *   - Em UPDATE/INSERT, invalida a query key `["copilot-toggle", orgId,
 *     normalized_phone]` exata. Outras query keys (legacy) ficam
 *     intencionalmente vivas — vão refetch ao próximo mount.
 *
 * Montar UMA VEZ no nível do app (AppShell ou root layout autenticado).
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { copilotToggleQueryKey } from "./useCopilotToggle";

interface PhoneAiPreferencesRow {
  organization_id: string;
  normalized_phone: string;
  ai_disabled: boolean;
  set_by: string | null;
  set_at: string;
}

export function useCopilotToggleRealtime() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  useEffect(() => {
    if (!organizationId) return;

    const channel = supabase
      .channel(`copilot-toggle-${organizationId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "phone_ai_preferences",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as Partial<PhoneAiPreferencesRow> | undefined;
          if (!row?.normalized_phone) return;

          const key = copilotToggleQueryKey(organizationId, row.normalized_phone);

          // Optimistic patch direto no cache — não espera refetch
          if (payload.eventType === "UPDATE" || payload.eventType === "INSERT") {
            const newRow = payload.new as PhoneAiPreferencesRow | undefined;
            if (newRow) {
              queryClient.setQueryData(key, {
                ai_disabled: Boolean(newRow.ai_disabled),
                source: "preference",
                organization_id: newRow.organization_id,
                normalized_phone: newRow.normalized_phone,
                lead_id: null,
              });
            }
          }

          // Garante refetch eventual pra trazer lead_id correlato + cache fresh
          queryClient.invalidateQueries({ queryKey: key });

          // Invalidate keys legadas que podem estar mostrando o estado antigo
          // (LeadDetailModal/Drawer leem lead-detail; Kanban lê pipe_*).
          queryClient.invalidateQueries({ queryKey: ["lead_ai_status"] });
          queryClient.invalidateQueries({ queryKey: ["lead-ai-status"] });
          queryClient.invalidateQueries({ queryKey: ["lead-detail"] });
          queryClient.invalidateQueries({ queryKey: ["leads"] });
          queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
          queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
          queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, queryClient]);
}
