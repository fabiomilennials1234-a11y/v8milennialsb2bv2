import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * O SUJEITO DA AUTOMAÇÃO — quem é o Negócio de uma execução.
 *
 * ── POR QUE UM MÓDULO, E NÃO TRÊS CÓPIAS ──────────────────────────────────
 * Três lugares respondiam "qual é a etapa?" com o MESMO código chumbado no
 * funil `whatsapp`: as duas cópias de `resolveVariables` (a do motor e a dos
 * helpers de WhatsApp) e o avaliador de condição. Enquanto o Lead era o card,
 * "a etapa do lead" existia e as três concordavam por acidente. Sob o ADR-0023
 * §1 a etapa é do NEGÓCIO, e "qual negócio" virou uma decisão — decisão que não
 * pode ser tomada de três jeitos diferentes.
 *
 * ── POR QUE FORA DO `pipeline-adapter` ────────────────────────────────────
 * Vinte arquivos de teste dublam o adapter com fábrica (`vi.mock(... () => ({...}))`),
 * e fábrica é lista FECHADA: export novo lá derruba os vinte com "No export is
 * defined" — 53 casos, medidos. O assunto aqui também é outro: o adapter fala
 * de `pipeline_entries`; este módulo fala de quem a automação está tratando.
 */

/**
 * A etapa do NEGÓCIO da execução — a resposta de `{{estagio}}` e da condição
 * `stage`.
 *
 * Ordem (ADR-0031):
 *   1. o negócio que disparou a execução. Vale para qualquer funil;
 *   2. sem negócio declarado (gatilho da pessoa), o negócio CORRENTE do lead —
 *      o aberto, senão o mais recente, em QUALQUER funil. É a mesma regra de
 *      `pickActiveEntry` e do `currentEntry` do avaliador de condição, de
 *      propósito: divergir criaria mais uma resposta para "qual negócio".
 *
 *      (Até o SCRUM-627 este fallback era o card de OPORTUNIDADES, chumbado:
 *      um lead cujo único negócio vive num funil custom respondia "" — e a
 *      condição de etapa decidia pelo motivo errado, em silêncio.)
 *   3. lead sem negócio em funil NENHUM → `""` (decisão SCRUM-627, pelo
 *      menos-surpresa: era o que o caminho antigo já devolvia quando não havia
 *      card de Oportunidades — variável não renderiza, `is_empty` casa, e
 *      nenhum valor congelado/mentiroso viaja numa mensagem).
 *
 * A conferência de org não é paranoia: estes caminhos rodam com service-role
 * (RLS fora) e o `entryId` chega por `context`, que é jsonb livre.
 */
export async function getStageDoNegocio(
  supabase: SupabaseClient,
  leadId: string,
  organizationId: string,
  entryId: string | null | undefined,
): Promise<string> {
  if (entryId) {
    const { data } = await supabase
      .from("pipeline_entries")
      .select("stage_key, organization_id")
      .eq("id", entryId)
      .maybeSingle();
    if (data && data.organization_id === organizationId) {
      return (data.stage_key as string) || "";
    }
  }

  // Fallback ADR-0031 — negócio corrente: aberto primeiro (closed_at nulo),
  // depois o que trocou de etapa por último, depois o criado por último.
  // O filtro por org é obrigatório: service-role bypassa a RLS.
  const { data } = await supabase
    .from("pipeline_entries")
    .select("stage_key, closed_at, stage_changed_at, created_at")
    .eq("lead_id", leadId)
    .eq("organization_id", organizationId)
    .order("closed_at", { ascending: false, nullsFirst: true })
    .order("stage_changed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  return ((data?.[0] as { stage_key?: string | null } | undefined)?.stage_key) || "";
}

/**
 * O id do Negócio guardado no `context` da execução.
 *
 * `context` é jsonb livre e o gatilho de banco pode mandar `null` dentro de um
 * `jsonb_build_object` — que chega como a STRING "null". Sem esta normalização
 * ela viajaria até um `.eq()` que não casa com nada.
 */
export function entryIdDoContexto(
  context: Record<string, unknown> | undefined | null,
): string | null {
  const raw = context?.pipeline_entry_id;
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v && v !== "null" ? v : null;
}
