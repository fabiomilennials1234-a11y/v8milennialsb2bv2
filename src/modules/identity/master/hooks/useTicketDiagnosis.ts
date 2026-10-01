/**
 * Diagnóstico + prompt de resolução de um Chamado (só master — a RLS de
 * `support_ticket_diagnoses` não abre nada ao cliente).
 *
 * Quem normalmente grava é o Claude Code, pelo torque-mcp
 * (`support.record_diagnosis`). Daqui saem o registro manual, a edição e o
 * fecho do ciclo: o desfecho da execução e o custo real.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useMasterAuth } from "./useMasterAuth";
import {
  parseUsd,
  type DiagnosisDraft,
  type ExecutionOutcome,
} from "../lib/ticket-diagnosis";

export type TicketDiagnosis = Tables<"support_ticket_diagnoses">;

const KEY = "master-ticket-diagnosis";

export function useTicketDiagnosis(ticketId: string) {
  const { isMaster } = useMasterAuth();

  return useQuery({
    queryKey: [KEY, ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_ticket_diagnoses")
        .select("*")
        .eq("ticket_id", ticketId)
        .maybeSingle();
      if (error) throw error;
      return data as TicketDiagnosis | null;
    },
    enabled: isMaster && !!ticketId,
  });
}

export function useSaveTicketDiagnosis() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ticketId, draft }: { ticketId: string; draft: DiagnosisDraft }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("support_ticket_diagnoses")
        .upsert(
          {
            ticket_id: ticketId,
            kind: draft.kind,
            complexity: draft.complexity,
            summary: draft.summary.trim(),
            root_cause: draft.root_cause.trim() || null,
            customer_reply: draft.customer_reply.trim() || null,
            recommended_model: draft.recommended_model,
            recommended_effort: draft.recommended_effort,
            resolution_prompt: draft.resolution_prompt.trim(),
            keystones: draft.keystones
              .map((k) => ({ label: k.label.trim(), verify: k.verify.trim() }))
              .filter((k) => k.label && k.verify),
            estimated_cost_usd: parseUsd(draft.estimated_cost_usd),
            source: "manual",
            diagnosed_by: auth.user?.id ?? null,
            // Um prompt novo invalida o desfecho da execução anterior.
            executed_at: null,
            execution_outcome: null,
            actual_cost_usd: null,
          },
          { onConflict: "ticket_id" },
        )
        .select()
        .single();
      if (error) throw error;
      return data as TicketDiagnosis;
    },
    onSuccess: (_d, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: [KEY, ticketId] });
    },
  });
}

/**
 * O fecho do ciclo. `null` em `outcome` reabre (desfaz o registro). Sem
 * `.select().single()` um UPDATE que não casa linha voltaria 200 calado.
 */
export function useRecordDiagnosisExecution() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ticketId,
      outcome,
      actualCostUsd,
    }: {
      ticketId: string;
      outcome: ExecutionOutcome | null;
      actualCostUsd: number | null;
    }) => {
      const { data, error } = await supabase
        .from("support_ticket_diagnoses")
        .update(
          outcome
            ? {
                executed_at: new Date().toISOString(),
                execution_outcome: outcome,
                actual_cost_usd: actualCostUsd,
              }
            : { executed_at: null, execution_outcome: null, actual_cost_usd: null },
        )
        .eq("ticket_id", ticketId)
        .select()
        .single();
      if (error) throw error;
      return data as TicketDiagnosis;
    },
    onSuccess: (_d, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: [KEY, ticketId] });
    },
  });
}
