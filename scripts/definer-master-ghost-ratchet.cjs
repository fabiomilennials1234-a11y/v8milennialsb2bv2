#!/usr/bin/env node
/**
 * Master-ghost ratchet.
 *
 * Fails CI when a SECURITY DEFINER function resolves org via team_members
 * membership without an is_master_user() escape hatch AND is not in the
 * accepted baseline. Also fails when the baseline lists a function that is no
 * longer a violation (stale entry) — forcing the count to only ratchet down.
 *
 *   node scripts/definer-master-ghost-ratchet.cjs          # check (CI)
 *   node scripts/definer-master-ghost-ratchet.cjs --write   # refresh baseline
 *
 * When you legitimately add a member-only definer function, run --write and get
 * the baseline diff reviewed: a reviewer must confirm master is not expected to
 * call it. When you ADD an is_master_user() branch to fix one, run --write to
 * ratchet the baseline down.
 */
const fs = require("fs");
const path = require("path");
const { scan } = require("./definer-master-ghost-scan.cjs");

const BASELINE_PATH = path.join(__dirname, "definer-master-ghost-baseline.json");

function loadBaseline() {
  try {
    return new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")).functions);
  } catch {
    return new Set();
  }
}

/** @returns {{ newViolations: string[], stale: string[], current: string[] }} */
function diff() {
  const current = scan().map((v) => v.name);
  const currentSet = new Set(current);
  const baseline = loadBaseline();
  const newViolations = current.filter((n) => !baseline.has(n)).sort();
  const stale = [...baseline].filter((n) => !currentSet.has(n)).sort();
  return { newViolations, stale, current };
}

function write() {
  const current = scan().map((v) => v.name).sort();
  const existing = (() => {
    try {
      return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8"));
    } catch {
      return {};
    }
  })();
  const out = {
    _comment:
      existing._comment ||
      "Master-ghost guard baseline. Legacy SECURITY DEFINER functions that resolve org via team_members/get_my_*_ids without is_master_user(). New entries require review: add is_master_user() branch OR justify membership-only. Regenerate: node scripts/definer-master-ghost-ratchet.cjs --write",
    generated_from: "scripts/definer-master-ghost-scan.cjs",
    count: current.length,
    functions: current,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`baseline refreshed: ${current.length} functions`);
}

module.exports = { diff };

if (require.main === module) {
  if (process.argv.includes("--write")) {
    write();
    process.exit(0);
  }
  const { newViolations, stale } = diff();
  let failed = false;

  if (newViolations.length) {
    failed = true;
    console.error(
      `\n✖ master-ghost: ${newViolations.length} NEW SECURITY DEFINER function(s) resolve org via team_members without an is_master_user() branch:\n`,
    );
    for (const n of newViolations) console.error(`    ${n}`);
    console.error(
      "\n  Master users (master_users) have no/inactive team_members row in a shadowed org,\n" +
        "  so these silently exclude master (empty lists / failed deletes cross-org).\n" +
        "  Fix: add an `IF public.is_master_user() THEN ... ELSE <team_members> END IF;` branch.\n" +
        "  If the function is genuinely member-only (master is not expected to call it),\n" +
        "  run `node scripts/definer-master-ghost-ratchet.cjs --write` and get the baseline\n" +
        "  diff reviewed.\n",
    );
  }

  if (stale.length) {
    failed = true;
    console.error(
      `\n✖ master-ghost: ${stale.length} baseline entr(y/ies) no longer violate — ratchet down with --write:\n`,
    );
    for (const n of stale) console.error(`    ${n}`);
  }

  if (failed) process.exit(1);
  console.log("✓ master-ghost: no new definer-via-membership functions without is_master_user()");
}
