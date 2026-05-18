/**
 * Kanban responsible-filter helper.
 *
 * Shared logic used by the system pipes (WhatsApp / Confirmação / Propostas)
 * to decide whether a pipeline_entries row matches the selected responsible
 * filter value (a `team_members.id`, or the sentinel `"all"`).
 *
 * Why this exists: the original per-page implementations only compared
 * `item.responsible_id` and `item.lead?.responsible_id` (sometimes plus
 * sdr_id / closer_id). They ignored `pre_sale_responsible_id` and
 * `sale_responsible_id` — both from the entry metadata and from the lead row.
 * Result: a lead where a member was only set as `pre_sale_responsible_id` on
 * the pipeline_entries.metadata silently disappeared when that member
 * filtered by themselves, even though RLS allowed the row through.
 *
 * Contract (display-only — RLS remains the source of truth for authorization):
 *
 *   matchesResponsibleFilter(item, "all") === true
 *   matchesResponsibleFilter(item, memberId) === true
 *     if memberId matches ANY non-null field in:
 *       entry: responsible_id, sdr_id, pre_sale_responsible_id, sale_responsible_id
 *       lead:  responsible_id, sdr_id, closer_id, pre_sale_responsible_id, sale_responsible_id
 *     otherwise false.
 *
 * Notes:
 *   - `closer_id` is intentionally NOT read from the entry: pipeline_entries
 *     metadata never stores it (only the lead row does). Confirmação and
 *     Propostas previously read `item.closer_id` from a `flattenMetadata`
 *     fall-through to `entry.lead?.closer_id` — that path is preserved by
 *     reading `lead.closer_id` here directly.
 *   - The function is intentionally permissive about input shape: any missing
 *     field is treated as a non-match (not a crash). Both the entry and the
 *     nested `lead` are optional.
 */

export interface KanbanFilterableLead {
  responsible_id?: string | null;
  sdr_id?: string | null;
  closer_id?: string | null;
  pre_sale_responsible_id?: string | null;
  sale_responsible_id?: string | null;
}

export interface KanbanFilterableItem {
  responsible_id?: string | null;
  sdr_id?: string | null;
  pre_sale_responsible_id?: string | null;
  sale_responsible_id?: string | null;
  lead?: KanbanFilterableLead | null;
}

const RESPONSIBLE_ALL = "all";

/**
 * Returns true if the given pipeline-entry-like item matches the responsible
 * filter value. See the file-level comment for the full field list.
 */
export function matchesResponsibleFilter(
  item: KanbanFilterableItem | null | undefined,
  filterId: string | null | undefined,
): boolean {
  if (!filterId || filterId === RESPONSIBLE_ALL) return true;
  if (!item) return false;

  const lead = item.lead ?? null;

  // Entry-level fields (from pipeline_entries flattened via flattenMetadata).
  if (item.responsible_id && item.responsible_id === filterId) return true;
  if (item.sdr_id && item.sdr_id === filterId) return true;
  if (item.pre_sale_responsible_id && item.pre_sale_responsible_id === filterId) return true;
  if (item.sale_responsible_id && item.sale_responsible_id === filterId) return true;

  // Lead-level fields (from the leads row joined into the entry).
  if (lead?.responsible_id && lead.responsible_id === filterId) return true;
  if (lead?.sdr_id && lead.sdr_id === filterId) return true;
  if (lead?.closer_id && lead.closer_id === filterId) return true;
  if (lead?.pre_sale_responsible_id && lead.pre_sale_responsible_id === filterId) return true;
  if (lead?.sale_responsible_id && lead.sale_responsible_id === filterId) return true;

  return false;
}
