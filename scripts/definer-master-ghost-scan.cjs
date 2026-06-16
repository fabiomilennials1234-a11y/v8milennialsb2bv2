#!/usr/bin/env node
/**
 * Master-ghost guard scanner.
 *
 * Detects the recurring "master-ghost" bug class: a SECURITY DEFINER function
 * that resolves the caller's organization EXCLUSIVELY through team_members
 * (directly, or via get_my_organization_ids()/get_my_admin_organization_ids()/
 * get_my_team_member_ids()) WITHOUT an is_master_user() escape hatch.
 *
 * Master users are global (master_users) and have no/inactive team_members row
 * in a shadowed org, so such functions silently exclude master — producing the
 * empty-list / "erro ao excluir lead" / cross-org no-op incidents we have had
 * (checklists 20261118000000, whatsapp list 20261126000000, lead trash
 * 20261212000000).
 *
 * Migrations are cumulative + immutable, so a function may be (re)defined many
 * times. Only the LAST definition (by sorted migration filename) is the live
 * one — we evaluate just that.
 *
 * Output: the live, non-allowlisted violations. Used by the ratchet
 * (definer-master-ghost-ratchet.cjs) and the unit guard test.
 */
const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "supabase", "migrations");

/**
 * Parse every CREATE [OR REPLACE] FUNCTION definition in a SQL file.
 * Returns [{ name, preamble, body }]. Handles dollar-quoted bodies with tags.
 */
function parseFunctions(sql) {
  const out = [];
  // CREATE [OR REPLACE] FUNCTION [public.]name ( args ) <preamble...> AS $tag$ body $tag$
  const re =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\)([\s\S]*?)\bAS\s+(\$\w*\$)([\s\S]*?)\4/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    out.push({ name: m[1], preamble: m[3] || "", body: m[5] || "" });
  }
  return out;
}

const RX = {
  definer: /SECURITY\s+DEFINER/i,
  teamMembersOrg: /from\s+(?:public\.)?team_members\b/i,
  orgIdColumn: /organization_id/i,
  helperGate:
    /\b(get_my_organization_ids|get_my_admin_organization_ids|get_my_team_member_ids)\s*\(/i,
  masterBranch: /\b(is_master_user|is_master)\s*\(|\bmaster_users\b/i,
};

/** A function body resolves org via team_members membership only. */
function resolvesOrgViaMembership(body) {
  if (RX.helperGate.test(body)) return true;
  if (RX.teamMembersOrg.test(body) && RX.orgIdColumn.test(body)) return true;
  return false;
}

function scan() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // timestamp prefix → chronological

  /** @type {Map<string, {file:string, preamble:string, body:string}>} */
  const live = new Map();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    for (const fn of parseFunctions(sql)) {
      live.set(fn.name, { file, preamble: fn.preamble, body: fn.body });
    }
  }

  const violations = [];
  for (const [name, def] of live) {
    const isDefiner = RX.definer.test(def.preamble);
    if (!isDefiner) continue;
    if (!resolvesOrgViaMembership(def.body)) continue;
    if (RX.masterBranch.test(def.body)) continue; // has master escape hatch
    violations.push({ name, file: def.file });
  }
  violations.sort((a, b) => a.name.localeCompare(b.name));
  return violations;
}

module.exports = { scan, parseFunctions, resolvesOrgViaMembership };

if (require.main === module) {
  const v = scan();
  console.log(`master-ghost scan: ${v.length} live definer-via-membership functions without is_master_user()`);
  for (const x of v) console.log(`  ${x.name}  (${x.file})`);
}
