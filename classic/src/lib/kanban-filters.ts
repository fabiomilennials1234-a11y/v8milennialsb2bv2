/**
 * Kanban responsible-filter helper.
 *
 * Shared logic used by the system pipes (WhatsApp / Confirmação / Propostas)
 * to decide whether a pipeline_entries row matches the selected responsible
 * filter value (a `team_members.id`, or the sentinel `"all"`).
 *
 * Dual-only contract (Issue #214 / PRD #211 — Fase A descomissionamento):
 *
 *   matchesResponsibleFilter(item, "all") === true
 *   matchesResponsibleFilter(item, memberId) === true
 *     if memberId matches ANY non-null field in:
 *       entry: pre_sale_responsible_id, sale_responsible_id
 *       lead:  pre_sale_responsible_id, sale_responsible_id
 *     otherwise false.
 *
 * Legacy fields (`responsible_id`, `sdr_id`, `closer_id`) on either the entry
 * metadata or the lead row are intentionally NOT consulted. The snapshot
 * trigger (`snapshot_responsible_from_lead`, commit `1ef3c547`) and the
 * `e3ac4599` backfill guarantee that dual columns are the source of truth for
 * crédito and per-member kanban filtering. Reading legacy here would
 * resurrect the contamination this PRD set out to eliminate: orgs whose
 * historical `responsible_id` points at the wrong member would still hit the
 * filter and pollute the per-vendor kanban view.
 *
 * Legacy fields remain on the input type (Fase B drops them) so callers
 * spreading raw row shapes still typecheck — they are simply ignored.
 *
 * Notes:
 *   - The function is intentionally permissive about input shape: any missing
 *     field is treated as a non-match (not a crash). Both the entry and the
 *     nested `lead` are optional.
 */

export interface KanbanFilterableLead {
  /** @deprecated Fase B drop — legacy responsibility column. Not read. */
  responsible_id?: string | null;
  /** @deprecated Fase B drop — legacy SDR column. Not read. */
  sdr_id?: string | null;
  /** @deprecated Fase B drop — legacy closer column. Not read. */
  closer_id?: string | null;
  pre_sale_responsible_id?: string | null;
  sale_responsible_id?: string | null;
}

export interface KanbanFilterableItem {
  /** @deprecated Fase B drop — legacy responsibility from entry metadata. Not read. */
  responsible_id?: string | null;
  /** @deprecated Fase B drop — legacy SDR from entry metadata. Not read. */
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

  // Entry-level dual fields (from pipeline_entries.metadata).
  if (item.pre_sale_responsible_id && item.pre_sale_responsible_id === filterId) return true;
  if (item.sale_responsible_id && item.sale_responsible_id === filterId) return true;

  // Lead-level dual fields (from the leads row joined into the entry).
  if (lead?.pre_sale_responsible_id && lead.pre_sale_responsible_id === filterId) return true;
  if (lead?.sale_responsible_id && lead.sale_responsible_id === filterId) return true;

  return false;
}
