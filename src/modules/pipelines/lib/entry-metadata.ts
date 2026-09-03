import { supabase } from "@/integrations/supabase/client";

/**
 * Escreve chaves no `pipeline_entries.metadata` PRESERVANDO as demais
 * (read-modify-write — mesmo padrão de `useSetMeetingDate`/`useMarkLost`).
 *
 * Existe por causa do ledger de venda (ADR-0017 §4): `fn_capture_sale_event`
 * snapshota `metadata->>'sale_value'` NO INSTANTE da transição para etapa
 * `won`. A página unificada move por `useMoverCardNoFunil` (que só escreve
 * `stage_key`), então o valor/motivo precisa estar no metadata ANTES do move —
 * este helper é o passo 1 de todo desfecho rico (won/lost) do fluxo unificado.
 */
export async function patchEntryMetadata(
  entryId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data, error: readErr } = await supabase
    .from("pipeline_entries")
    .select("metadata")
    .eq("id", entryId)
    .single();
  if (readErr) throw readErr;

  const metadata = {
    ...((data?.metadata as Record<string, unknown>) ?? {}),
    ...patch,
  };

  const { error: writeErr } = await supabase
    .from("pipeline_entries")
    // `Json` do types gerado não aceita Record<string, unknown> diretamente —
    // mesmo cast dos escritores irmãos (useSetMeetingDate faz igual via shape).
    .update({ metadata: metadata as never })
    .eq("id", entryId);
  if (writeErr) throw writeErr;
}
