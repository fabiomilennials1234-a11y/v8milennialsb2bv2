// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve("scripts/ci/prepare-historical-fixtures.mjs");
const filename = "supabase/migrations/20270924235959_ci_historical_fixtures.sql";
const owned: string[] = [];
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "torque-ci-fixture-test-"));
  owned.push(dir);
  mkdirSync(join(dir, "supabase/migrations"), { recursive: true });
  return dir;
};
const run = (cwd: string, env: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [script], {
  cwd, encoding: "utf8", env: { ...process.env, CI: "true", GITHUB_ACTIONS: "true", SUPABASE_URL: "", VITE_SUPABASE_URL: "", ...env },
});
afterEach(() => {
  for (const dir of owned.splice(0)) {
    const target = realpathSync(dir);
    if (!target.startsWith(realpathSync(tmpdir()) + sep) || !target.includes("torque-ci-fixture-test-")) throw new Error("Unsafe test cleanup");
    rmSync(target, { recursive: true });
  }
});

describe("CI historical fixture isolation", () => {
  it("copies the exact synthetic fixture in an isolated CI checkout", () => {
    const dir = setup();
    expect(run(dir).status).toBe(0);
    expect(readFileSync(join(dir, filename), "utf8")).toBe(readFileSync("scripts/ci/historical-fixtures.sql", "utf8"));
  });
  it.each([{ CI: "false" }, { GITHUB_ACTIONS: "false" }, { SUPABASE_URL: "https://example.supabase.co" }, { VITE_SUPABASE_URL: "https://localhost.example.com" }])("refuses unsafe environment %j", (env) => {
    const dir = setup();
    expect(run(dir, env).status).not.toBe(0);
    expect(existsSync(join(dir, filename))).toBe(false);
  });
  it("refuses a linked project and never overwrites a migration", () => {
    const dir = setup();
    mkdirSync(join(dir, "supabase/.temp"));
    writeFileSync(join(dir, "supabase/.temp/project-ref"), "test-linked-project");
    expect(run(dir).status).not.toBe(0);
    expect(existsSync(join(dir, filename))).toBe(false);
    const other = setup();
    writeFileSync(join(other, filename), "existing");
    expect(run(other).status).not.toBe(0);
    expect(readFileSync(join(other, filename), "utf8")).toBe("existing");
  });
});
