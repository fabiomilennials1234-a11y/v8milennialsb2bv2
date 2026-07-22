// @vitest-environment node
/**
 * Blast refusal codes → text a salesperson can act on.
 *
 * Before this map the dialog piped the backend's machine code straight into
 * the toast, so hitting a ceiling showed the literal `daily_budget_exhausted`.
 */

import { describe, it, expect } from "vitest";
import { blastErrorMessage } from "@/modules/leads/lib/blast-error-messages";

describe("blastErrorMessage", () => {
  it("translates every refusal the backend can return", () => {
    // Codes returned by runQuickBlast / quick-blast-create.
    const codes = [
      "daily_budget_exhausted",
      "instance_daily_cap_exhausted",
      "wa_reach_limit_reached",
      "no_recipients",
      "no_leads",
      "empty_message",
      "instance_org_mismatch",
      "blast_failed",
    ];

    for (const code of codes) {
      const msg = blastErrorMessage(code);
      expect(msg, code).not.toBe(code);
      // A machine code leaking through means the user reads an identifier.
      expect(msg, code).not.toMatch(/^[a-z0-9]+(_[a-z0-9]+)+$/);
    }
  });

  it("tells the user what to do about the reach limit, not just that it happened", () => {
    const msg = blastErrorMessage("wa_reach_limit_reached");
    expect(msg).toMatch(/outro número|aguarde/i);
  });

  it("falls back to the raw text for an unknown code", () => {
    // More useful on screen than a generic failure, and it keeps the gap
    // visible instead of hiding it.
    expect(blastErrorMessage("some_new_code")).toBe("some_new_code");
  });

  it("has a message for a missing code", () => {
    expect(blastErrorMessage(undefined)).toBeTruthy();
    expect(blastErrorMessage(null)).toBeTruthy();
    expect(blastErrorMessage("")).toBeTruthy();
  });
});
