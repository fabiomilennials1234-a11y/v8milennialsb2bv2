/**
 * orgBlastCap — Quick Blast org-level lead ceiling.
 *
 * The cap is the sole safety guardrail for Quick Blast (no role gate — ADR-0002).
 * It MUST fail closed: any missing/invalid configuration resolves to the safe
 * default, never to "unlimited".
 */

export const DEFAULT_BLAST_CAP = 200;

/**
 * Resolve the effective per-blast ceiling from a raw stored config value.
 * Returns the configured positive integer, or DEFAULT_BLAST_CAP for anything
 * missing/invalid (null, undefined, 0, negative, NaN, Infinity).
 */
export function resolveOrgCap(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return DEFAULT_BLAST_CAP;
  if (!Number.isFinite(raw)) return DEFAULT_BLAST_CAP;
  const floored = Math.floor(raw);
  if (floored < 1) return DEFAULT_BLAST_CAP;
  return floored;
}

/**
 * IO wrapper — read the org's configured ceiling and resolve it fail-closed.
 * Not unit-tested (thin DB read); the pure resolveOrgCap carries the logic.
 */
export async function getOrgBlastCap(
  supabaseAdmin: { from: (t: string) => any },
  orgId: string,
): Promise<number> {
  try {
    const { data } = await supabaseAdmin
      .from("organizations")
      .select("quick_blast_max_leads")
      .eq("id", orgId)
      .maybeSingle();
    return resolveOrgCap(data?.quick_blast_max_leads ?? null);
  } catch {
    return DEFAULT_BLAST_CAP;
  }
}
