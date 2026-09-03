/**
 * Define a data da reunião (+ link opcional) num pipeline_entry (ADR-0004, Slice 3).
 *
 * Grava em `pipeline_entries.metadata.meeting_date` / `.meet_link`.
 * Read-modify-write para preservar as demais chaves do metadata.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useSetMeetingDate() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      entryId,
      meetingDate,
      meetLink,
    }: {
      entryId: string;
      meetingDate: string;
      meetLink?: string | null;
    }) => {
      const { data: row, error: readErr } = await supabase
        .from("pipeline_entries")
        .select("metadata")
        .eq("id", entryId)
        .single();
      if (readErr) throw readErr;

      const metadata = {
        ...((row?.metadata as Record<string, unknown>) ?? {}),
        meeting_date: meetingDate,
        ...(meetLink !== undefined ? { meet_link: meetLink || null } : {}),
      };

      const { error: writeErr } = await supabase
        .from("pipeline_entries")
        .update({ metadata })
        .eq("id", entryId);
      if (writeErr) throw writeErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline-page"] });
      qc.invalidateQueries({ queryKey: ["pipeline-stage-counts"] });
    },
  });
}
