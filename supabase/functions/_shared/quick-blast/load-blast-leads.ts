import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { BlastLead } from "./recipients.ts";

/** Mantém a URL do filtro PostgREST abaixo do limite do gateway. */
export const BLAST_LEAD_QUERY_CHUNK_SIZE = 100;

/**
 * Carrega uma audiência por ids sem montar uma única URL gigante de `.in(...)`.
 * Falha explicitamente se qualquer lote falhar; uma consulta quebrada nunca
 * pode ser confundida com uma audiência realmente vazia.
 */
export async function loadBlastLeadsByIds(
  supabase: SupabaseClient,
  organizationId: string,
  leadIds: string[],
): Promise<BlastLead[]> {
  const orderedIds = Array.from(
    new Set(leadIds.filter((id) => typeof id === "string" && id.length > 0)),
  );
  if (orderedIds.length === 0) return [];

  const byId = new Map<string, BlastLead>();

  for (let offset = 0; offset < orderedIds.length; offset += BLAST_LEAD_QUERY_CHUNK_SIZE) {
    const chunk = orderedIds.slice(offset, offset + BLAST_LEAD_QUERY_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("leads")
      .select("id, name, company, phone")
      .eq("organization_id", organizationId)
      .in("id", chunk);

    if (error) {
      throw new Error(`Falha ao carregar a audiência do disparo: ${error.message}`);
    }

    for (const row of (data ?? []) as BlastLead[]) byId.set(row.id, row);
  }

  return orderedIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}
