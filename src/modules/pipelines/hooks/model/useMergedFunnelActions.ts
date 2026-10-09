/**
 * Ações de desfecho de reunião no funil mergeado (ADR-0004, Slice 4).
 *
 * - useRescheduleMeeting: define nova data, volta o card pra `agendado` e
 *   reseta a confirmação pra `pendente` — tudo num update.
 * - useMarkLost: marca perdido — move pro stage final_negative da org +
 *   grava o motivo (id do catálogo + rótulo snapshotado, `patchDaPerda`) no
 *   metadata NA MESMA escrita do move.
 *
 * Read-modify-write no metadata para preservar as demais chaves.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { patchDaPerda, type PerdaResolvida } from "../../lib/loss-reason";

async function readMetadata(entryId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("pipeline_entries")
    .select("metadata")
    .eq("id", entryId)
    .single();
  if (error) throw error;
  return (data?.metadata as Record<string, unknown>) ?? {};
}

export function useRescheduleMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ entryId, meetingDate }: { entryId: string; meetingDate: string }) => {
      const metadata = {
        ...(await readMetadata(entryId)),
        meeting_date: meetingDate,
        confirmation_status: "pendente",
        is_confirmed: false,
      };
      const { error } = await supabase
        .from("pipeline_entries")
        .update({ metadata, stage_key: "agendado" })
        .eq("id", entryId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline-page"] });
      qc.invalidateQueries({ queryKey: ["pipeline-stage-counts"] });
    },
  });
}

export function useMarkLost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entryId,
      lostStageKey,
      perda,
    }: {
      entryId: string;
      lostStageKey: string;
      /** Obrigatório (SCRUM-369) — vem da porta única `useLossReasonGate`. */
      perda: PerdaResolvida;
    }) => {
      const metadata = {
        ...(await readMetadata(entryId)),
        ...patchDaPerda(perda),
      };
      const { error } = await supabase
        .from("pipeline_entries")
        .update({ metadata, stage_key: lostStageKey })
        .eq("id", entryId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline-page"] });
      qc.invalidateQueries({ queryKey: ["pipeline-stage-counts"] });
    },
  });
}
