/**
 * Pure mappers/predicates: board filter UI → generic server-filter params
 * consumed by `usePaginatedPipeline` (and ultimately the get_pipeline_page /
 * get_pipeline_stage_counts RPCs).
 *
 * As faixas de "Calor" e "Prioridade" saíram daqui em 2026-09-03 junto com a
 * remoção do calor da interface — nem `p_calor_min/max` nem `p_rating_min/max`
 * são mais enviados. Os parâmetros seguem existindo na assinatura das RPCs com
 * DEFAULT NULL (removê-los é fatia SQL).
 */

/**
 * Confirmação: stages excluded from the "overdue" bucket. Mirrors
 * isConfirmacaoOverdue (compareceu / perdido are never overdue).
 */
export const CONFIRMACAO_OVERDUE_EXCLUDE_STATUS_KEYS = ["compareceu", "perdido"] as const;

/**
 * Client-side qualification-tier membership predicate. Used by the boards NOT
 * resolved server-side — CustomPipeline and Negócios — so their cards AND their
 * column counts are filtered by the SAME rule (badge == cards). Kept byte-for-
 * byte equivalent to the server predicate in get_pipeline_page /
 * get_pipeline_stage_counts (`l.qualification_tier::text = ANY(p_*)`):
 *
 *   - empty selection  → no filter (NULL-collapse: "todos")
 *   - null/undefined tier → never matches a non-empty selection
 *   - otherwise         → string membership
 */
export function matchesTierFilter(
  tier: string | null | undefined,
  selected: string[] | null | undefined,
): boolean {
  if (!selected || selected.length === 0) return true;
  return tier != null && selected.includes(tier);
}

/**
 * Combined qualification + pre-qualification predicate for a lead-bearing row.
 * Both dimensions are ANDed, matching how the two server params compose.
 */
export function matchesQualificationFilters(
  lead:
    | { qualification_tier?: string | null; pre_qualification_tier?: string | null }
    | null
    | undefined,
  qualificationTier: string[] | null | undefined,
  preQualificationTier: string[] | null | undefined,
): boolean {
  return (
    matchesTierFilter(lead?.qualification_tier, qualificationTier) &&
    matchesTierFilter(lead?.pre_qualification_tier, preQualificationTier)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Responsável — funis personalizados
//
// ⚠️ Nome deliberadamente distinto do `matchesResponsibleFilter` de
// `src/lib/kanban-filters.ts`. Aquele casa SÓ o par dual
// (`pre_sale_responsible_id` / `sale_responsible_id`) do PRD #211 e hoje não
// tem nenhum consumidor em `src/` — reaproveitá-lo aqui devolveria ZERO card,
// porque `useCustomPipeEntries` nem seleciona essas duas colunas do lead. E
// mesmo selecionando, a semântica dele é "casa QUALQUER um dos campos",
// enquanto o card do funil custom desenha só o PRIMEIRO da cadeia — filtrar por
// um nome traria card escrito com outro.
// ─────────────────────────────────────────────────────────────────────────────

/** Forma mínima de uma entry de funil custom para resolver o responsável. */
export interface ResponsibleBearingEntry {
  assigned_to?: string | null;
  lead?: {
    responsible?: { id?: string | null } | null;
    closer?: { id?: string | null } | null;
    sdr?: { id?: string | null } | null;
  } | null;
}

/**
 * Responsável EFETIVO de uma entry de funil custom, em `team_members.id`.
 *
 * A ordem é a MESMA de `CustomPipelineKanban.transformToCard` (responsible →
 * closer → sdr → assigned_to da entry). Ela precisa ser idêntica: o filtro tem
 * que casar com o nome que o card mostra, senão o operador seleciona "José" e
 * some um card que está escrito "José" (ou sobra um escrito "Elena").
 *
 * Os quatro campos são FK para `team_members.id` — inclusive
 * `custom_pipe_entries.assigned_to`, que NÃO aponta para `profiles`/`user_id`.
 */
export function resolveCustomPipeResponsibleId(
  entry: ResponsibleBearingEntry | null | undefined,
): string | null {
  const lead = entry?.lead;
  return (
    lead?.responsible?.id ??
    lead?.closer?.id ??
    lead?.sdr?.id ??
    entry?.assigned_to ??
    null
  );
}

/**
 * Predicado client-side do filtro "Responsável" nos funis personalizados.
 *
 * `"all"` (ou vazio) = sem filtro, espelhando o `SelectItem value="all"` do
 * `KanbanFilterPanel`. Entry sem responsável nenhum nunca casa com uma seleção
 * ativa — mesma regra de NULL do filtro de qualificação.
 */
export function matchesCustomPipeResponsible(
  entry: ResponsibleBearingEntry | null | undefined,
  responsibleId: string | null | undefined,
): boolean {
  if (!responsibleId || responsibleId === "all") return true;
  return resolveCustomPipeResponsibleId(entry) === responsibleId;
}
