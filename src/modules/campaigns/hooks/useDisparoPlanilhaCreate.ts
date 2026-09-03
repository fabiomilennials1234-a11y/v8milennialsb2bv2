/**
 * useDisparoPlanilhaCreate — "Subir planilha" blast source (ADR-0014, #906).
 *
 * Thin mutation over the `disparo-planilha-create` edge function. The org is
 * resolved server-side from the JWT — the front never sends organization_id.
 *
 * Two phases share one hook:
 *   - `dryRun: true`  → preview counts only (no writes): X criados · Y já no CRM
 *     · Z inválidos · W duplicados.
 *   - `dryRun` absent → creates the non-matches, seeds them into the chosen
 *     funnel/stage, tags the new ones, and returns every valid recipient id.
 */
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MappedRow } from "../components/disparo-wizard/spreadsheet-parse";

export interface PlanilhaCreateInput {
  rows: MappedRow[];
  /** Funil de destino — `pipelines.id` (canônico, Fatia B). O servidor também
   *  aceita slug/alias legado, lendo o formato antigo pra sempre. */
  funnel: string;
  /** Etapa de destino — `pipeline_stages.id` (canônico) ou stage_key legada. */
  stage: string;
  /** Tag ids applied to NEWLY created leads only (matched leads untouched). */
  tags?: string[];
  /** Preview mode — compute counts without creating anything. */
  dryRun?: boolean;
}

export interface PlanilhaReport {
  created: number;
  matched: number;
  invalid: number;
  duplicates: number;
}

export interface PlanilhaCreateResult {
  ok: true;
  /** Present only on a real (non-dry-run) call. */
  lead_ids?: string[];
  recipient_count: number;
  report: PlanilhaReport;
  dry_run?: boolean;
}

export function useDisparoPlanilhaCreate() {
  return useMutation<PlanilhaCreateResult, Error, PlanilhaCreateInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.functions.invoke("disparo-planilha-create", {
        body: {
          rows: input.rows,
          funnel: input.funnel,
          stage: input.stage,
          tags: input.tags ?? [],
          dry_run: input.dryRun === true,
        },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as PlanilhaCreateResult;
    },
  });
}
