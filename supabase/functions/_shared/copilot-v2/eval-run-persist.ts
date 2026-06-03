/**
 * eval-run-persist — Copilot v2 (W13). The edge sink for eval results (Slice 9
 * "persist eval runs" follow-up): maps results to copilot_v2_eval_runs rows (org
 * from context) and writes them via an injected service_role writer. Keeping the
 * writer injected makes the mapping testable without a live DB; the edge passes
 * the real `(rows) => supabase.from('copilot_v2_eval_runs').insert(rows)`.
 *
 * No-op on empty (never calls the writer); surfaces an insert error loudly so a
 * broken sink is visible rather than silently swallowed.
 */

import { evalRunRow, type EvalRunRow } from "./eval-run-row.ts";
import type { EvalRunResult } from "./eval-runner.ts";

export type EvalRunWriter = (
  rows: EvalRunRow[],
) => Promise<{ error: { message: string } | null }>;

export async function persistEvalRuns(
  results: EvalRunResult[],
  organizationId: string,
  write: EvalRunWriter,
  traceId?: string | null,
): Promise<number> {
  if (results.length === 0) return 0;
  const rows = results.map((r) => evalRunRow(r, organizationId, traceId));
  const { error } = await write(rows);
  if (error) throw new Error(`persistEvalRuns: ${error.message}`);
  return rows.length;
}
