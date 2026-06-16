// @vitest-environment node
/**
 * Master-ghost regression guard.
 *
 * Recurring bug class: a SECURITY DEFINER function resolves the caller's org
 * EXCLUSIVELY via team_members (directly or through get_my_organization_ids() /
 * get_my_admin_organization_ids() / get_my_team_member_ids()) WITHOUT an
 * is_master_user() escape hatch. Master users are global (master_users) with
 * no/inactive team_members row in a shadowed org, so such functions silently
 * exclude master.
 *
 * Incidents: checklists (20261118000000), whatsapp conversation list
 * (20261126000000), lead trash RPCs (20261212000000).
 *
 * This test fails if a NEW such function appears beyond the accepted baseline
 * (scripts/definer-master-ghost-baseline.json). To fix a flagged function add an
 * `IF public.is_master_user() THEN ... ELSE <team_members> END IF;` branch. If a
 * function is genuinely member-only, refresh the baseline
 * (`node scripts/definer-master-ghost-ratchet.cjs --write`) and get the diff
 * reviewed. Full ratchet (incl. stale-entry cleanup) runs in the npm script.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(__filename);
const { diff } = require("../../scripts/definer-master-ghost-ratchet.cjs");

describe("master-ghost guard", () => {
  it("has no NEW SECURITY DEFINER function resolving org via team_members without is_master_user()", () => {
    const { newViolations } = diff();
    expect(
      newViolations,
      newViolations.length
        ? `New master-ghost-prone function(s): ${newViolations.join(", ")}. ` +
            "Add an is_master_user() branch, or if genuinely member-only run " +
            "`node scripts/definer-master-ghost-ratchet.cjs --write` and get the baseline diff reviewed."
        : undefined,
    ).toEqual([]);
  });
});
