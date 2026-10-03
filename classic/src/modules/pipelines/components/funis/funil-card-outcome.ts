import type { StageRole } from "@/contracts/pipe";

interface EntryWithOutcome {
  metadata?: Record<string, unknown> | null;
}

/** O desfecho que o card mostra. `null` = negócio aberto. */
export type CardOutcome = "won" | "lost";

/**
 * O card do funil representa um negócio GANHO ou PERDIDO?
 *
 * O desfecho é fato do negócio (`deals.outcome`, ADR-0023 Emenda 1), e
 * `get_pipeline_page` o projeta em `metadata.deal_outcome` (20271021000039).
 * Quando a chave vem, ela decide sozinha — inclusive para dizer "aberto": um
 * negócio reaberto que ficou parado na etapa de ganho ou de perda NÃO pinta.
 *
 * Quando a chave não vem, o card não tem linha em `deals` (26,6% em prod) ou o
 * leitor ainda é o anterior à migration. Aí o papel da etapa responde, que é
 * exatamente como o caderno de vendas trata card sem negócio.
 */
export function cardOutcome(entry: EntryWithOutcome, stageRole: StageRole | null | undefined): CardOutcome | null {
  const outcome = entry.metadata?.deal_outcome;
  if (typeof outcome === "string") return outcome === "won" || outcome === "lost" ? outcome : null;
  return stageRole === "won" || stageRole === "lost" ? stageRole : null;
}

interface EntryWithDates extends EntryWithOutcome {
  stage_changed_at?: string | null;
  entered_at?: string | null;
  created_at?: string | null;
}

/**
 * QUANDO o negócio foi ganho ou perdido — a data que separa o grupo de
 * encerrados da coluna por mês.
 *
 * A fonte é `deals.outcome_at`, projetado como `metadata.deal_outcome_at`
 * (20271021000040). Sem a chave — card sem negócio, ou leitor anterior à
 * migration — recua para a entrada na etapa: no funil com etapa de ganho ou de
 * perda, é quando o card chegou nela, o que aproxima o desfecho.
 */
export function cardClosedAt(entry: EntryWithDates): string | null {
  const at = entry.metadata?.deal_outcome_at;
  if (typeof at === "string" && at) return at;
  return entry.stage_changed_at ?? entry.entered_at ?? entry.created_at ?? null;
}
