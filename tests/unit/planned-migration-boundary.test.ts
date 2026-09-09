import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("planned SQL is not an applied migration", () => {
  const file = "20270925000000_aposenta_calor_e_rating.sql";
  it("preserves the original retirement proposal without auto-applying it", () => {
    expect(existsSync(`supabase/migrations/${file}`)).toBe(false);
    const sql = readFileSync(`supabase/proposals/${file}`, "utf8").replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(sql).digest("hex"))
      .toBe("05cb0ed6ff20b8c036f99b4143921974bef8ad498da11d030be01bd37b8a2a50");
    expect(existsSync(`supabase/migrations/rollback/${file}`)).toBe(true);
  });
  it("does not seed production-only prerequisites into the automatic chain", () => {
    expect(readFileSync(".github/workflows/test.yml", "utf8"))
      .not.toContain("node scripts/ci/prepare-historical-fixtures.mjs");
  });
});
