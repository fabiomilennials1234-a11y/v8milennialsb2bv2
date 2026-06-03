/**
 * eval-cases-loader — Copilot v2 (Slice 9). Loads enabled eval cases for the
 * caller's org (RLS-scoped via the user client) and maps DB rows → EvalCase. The
 * row→case mapping is pure (tested); the fetch is thin I/O.
 */

import type { EvalCase } from "./eval-runner.ts";
import type { Archetype } from "./model-selector.ts";

export interface EvalCaseRow {
  id: string;
  archetype: Archetype;
  case_name: string;
  input_message: string;
  expected_tier: string | null;
  expected_tool: string | null;
  expected_action: string | null;
  expected_resist?: string | null;
  enabled: boolean;
}

export function mapRowToEvalCase(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    caseName: row.case_name,
    archetype: row.archetype,
    inputMessage: row.input_message,
    enabled: row.enabled,
    expectedTier: (row.expected_tier ?? undefined) as EvalCase["expectedTier"],
    expectedTool: row.expected_tool ?? undefined,
    expectedAction: row.expected_action ?? undefined,
    expectedResist: row.expected_resist ?? undefined,
  };
}

interface MinimalClient {
  from: (t: string) => {
    select: (c: string) => {
      eq: (k: string, v: unknown) => any;
    };
  };
}

/** Fetches enabled cases for the caller's org (RLS-scoped), optionally by archetype. */
export async function loadEvalCases(supabase: MinimalClient, archetype?: Archetype): Promise<EvalCase[]> {
  let q = supabase
    .from("copilot_v2_eval_cases")
    .select("id, archetype, case_name, input_message, expected_tier, expected_tool, expected_action, expected_resist, enabled")
    .eq("enabled", true);
  if (archetype) q = q.eq("archetype", archetype);
  const { data, error } = await q;
  if (error) throw new Error(`loadEvalCases: ${error.message}`);
  return ((data ?? []) as EvalCaseRow[]).map(mapRowToEvalCase);
}
