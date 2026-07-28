/**
 * Persiste o status de confirmação de reunião num pipeline_entry (ADR-0004).
 *
 * Status mora em `pipeline_entries.metadata.confirmation_status`. Mantém o
 * boolean legado `is_confirmed` em sincronia (true só quando `confirmado`).
 * Read-modify-write para não sobrescrever outras chaves do metadata.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ConfirmationStatus } from "../../lib/confirmation-button";

export function useSetConfirmationStatus() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ entryId, status }: { entryId: string; status: ConfirmationStatus }) => {
      const { data: row, error: readErr } = await supabase
        .from("pipeline_entries")
        .select("metadata")
        .eq("id", entryId)
        .single();
      if (readErr) throw readErr;

      const metadata = {
        ...((row?.metadata as Record<string, unknown>) ?? {}),
        confirmation_status: status,
        is_confirmed: status === "confirmado",
      };

      const { error: writeErr } = await supabase
        .from("pipeline_entries")
        .update({ metadata })
        .eq("id", entryId);
      if (writeErr) throw writeErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline-page", "whatsapp"] });
    },
  });
}
