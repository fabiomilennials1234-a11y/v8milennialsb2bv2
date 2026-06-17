/**
 * Migration version-collision guard (ratchet).
 *
 * `supabase db push` records ONE name per version prefix and SILENTLY SKIPS any
 * other file that shares the version — so a colliding migration's SQL never runs
 * in prod. This class produced ~20 silent skips (audit:
 * docs/meta-cloud-cert/MIGRATION-COLLISION-AUDIT.md).
 *
 * This test fails when a NEW duplicate version prefix appears beyond the known
 * pre-existing baseline. Fix the new migration's timestamp (must be unique);
 * never add it to the baseline to silence the test. The baseline only SHRINKS as
 * the legacy collisions are cleaned up.
 */
import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(__dirname, "../../supabase/migrations");

// Pre-existing duplicate version prefixes (tech debt, being cleaned up). NEW
// collisions are NOT allowed. As legacy dups are re-timestamped, REMOVE the
// resolved version from this set (it only shrinks).
const BASELINE_DUPLICATE_VERSIONS = new Set<string>([
  "20260603000000", "20260930000000", "20260985000000", "20261012000000",
  "20261016000000", "20261016000001", "20261026000000", "20261030000000",
  "20261030000001", "20261031000000", "20261031000004", "20261031000008",
  "20261105000000", "20261105000001", "20261119000000", "20261121000000",
  "20261125000000", "20261127000000", "20261128000000", "20261215000000",
]);

function duplicateVersionPrefixes(): string[] {
  const counts = new Map<string, number>();
  for (const f of readdirSync(MIGRATIONS_DIR)) {
    const m = /^(\d{14})_.*\.sql$/.exec(f);
    if (!m) continue;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([v]) => v);
}

describe("migration version-collision guard", () => {
  it("no NEW duplicate migration version prefix beyond the known baseline", () => {
    const dups = duplicateVersionPrefixes();
    const newDups = dups.filter((v) => !BASELINE_DUPLICATE_VERSIONS.has(v));
    expect(newDups).toEqual([]);
  });

  it("baseline only shrinks — remove resolved collisions from the set", () => {
    // If a baselined version is no longer duplicated (cleaned up), drop it from
    // BASELINE_DUPLICATE_VERSIONS so the ratchet keeps tightening.
    const dups = new Set(duplicateVersionPrefixes());
    const staleBaseline = [...BASELINE_DUPLICATE_VERSIONS].filter((v) => !dups.has(v));
    expect(staleBaseline).toEqual([]);
  });
});
