import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPipeEntry } from "./pipeline-adapter.ts";
import type { PipeSlug } from "./pipeline-adapter.ts";

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
 * Ordem:
 *   1. o negócio que disparou a execução. Vale para qualquer funil;
 *   2. sem negócio declarado (gatilho da pessoa), o card de Oportunidades —
 *      exatamente o que os três faziam antes, para não mudar o veredito de
 *      nenhum workflow que já roda hoje.
 *
 * A conferência de org não é paranoia: estes caminhos rodam com service-role
 * (RLS fora) e o `entryId` chega por `context`, que é jsonb livre.
 */
export async function getStageDoNegocio(
  supabase: SupabaseClient,
  leadId: string,
  organizationId: string,
  entryId: string | null | undefined,
  fallbackSlug: PipeSlug = "whatsapp",
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

  const entry = await getPipeEntry(supabase, leadId, organizationId, fallbackSlug);
  return entry?.stage_key || "";
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
