/**
 * Unit tests for the tombstone reap policy (#1476, PRD #1472).
 *
 * The collector's decision — confirm, retry, or give up — is pure logic kept out
 * of the edge function so it can be exercised without network or database. The
 * edge function does IO; this decides what the IO means.
 *
 * Why the policy is load-bearing: a tombstone that retries forever holds a
 * credential at rest forever, and a tombstone that gives up too early leaves an
 * orphan on the provider. Both failures are silent.
 */

import { describe, it, expect } from "vitest";
import {
  decideReap,
  backoffDelayMs,
  REAP_MAX_ATTEMPTS,
  type ReapDecision,
} from "../../supabase/functions/_shared/whatsapp-reap-policy.ts";

const ONE_MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

describe("backoffDelayMs", () => {
  it("walks 1 → 2 → 4 → 8 → 16 minutes", () => {
    expect(backoffDelayMs(1)).toBe(1 * ONE_MINUTE);
    expect(backoffDelayMs(2)).toBe(2 * ONE_MINUTE);
    expect(backoffDelayMs(3)).toBe(4 * ONE_MINUTE);
    expect(backoffDelayMs(4)).toBe(8 * ONE_MINUTE);
    expect(backoffDelayMs(5)).toBe(16 * ONE_MINUTE);
  });

  it("caps at 16 minutes instead of growing without bound", () => {
    expect(backoffDelayMs(6)).toBe(16 * ONE_MINUTE);
    expect(backoffDelayMs(50)).toBe(16 * ONE_MINUTE);
  });

  it("treats a nonsensical attempt count as the first attempt", () => {
    expect(backoffDelayMs(0)).toBe(1 * ONE_MINUTE);
    expect(backoffDelayMs(-3)).toBe(1 * ONE_MINUTE);
  });
});

// ---------------------------------------------------------------------------
// No credential — nothing to attempt
// ---------------------------------------------------------------------------

describe("decideReap — no credential", () => {
  it("gives up immediately, because no amount of retrying invents a token", () => {
    const d = decideReap({ hasToken: false, attempts: 0 });

    expect(d.action).toBe("give_up");
    expect(d.reason).toMatch(/credencial/i);
  });

  it("gives up on a missing credential even when attempts are still available", () => {
    const d = decideReap({ hasToken: false, attempts: 1 });

    expect(d.action).toBe("give_up");
  });
});

// ---------------------------------------------------------------------------
// Success paths
// ---------------------------------------------------------------------------

describe("decideReap — confirmed", () => {
  it("confirms on a successful delete", () => {
    const d = decideReap({
      hasToken: true,
      attempts: 0,
      outcome: { ok: true, status: 200 },
    });

    expect(d.action).toBe("confirm");
  });

  it("confirms on 404 — an instance that does not exist IS the desired state", () => {
    const d = decideReap({
      hasToken: true,
      attempts: 0,
      outcome: { ok: false, status: 404, error: "not found" },
    });

    expect(d.action).toBe("confirm");
    expect(d.reason).toMatch(/n[ãa]o existe/i);
  });
});

// ---------------------------------------------------------------------------
// Permanent failures — retrying cannot help
// ---------------------------------------------------------------------------

describe("decideReap — permanent provider rejection", () => {
  it.each([401, 403])(
    "gives up on %i instead of burning attempts on a credential the provider refuses",
    (status) => {
      const d = decideReap({
        hasToken: true,
        attempts: 0,
        outcome: { ok: false, status, error: "unauthorized" },
      });

      expect(d.action).toBe("give_up");
      expect(d.reason).toMatch(/credencial|recusad/i);
    }
  );
});

// ---------------------------------------------------------------------------
// Transient failures — retry with backoff
// ---------------------------------------------------------------------------

describe("decideReap — transient failure", () => {
  it("retries a 5xx with the backoff for the next attempt", () => {
    const d = decideReap({
      hasToken: true,
      attempts: 0,
      outcome: { ok: false, status: 503, error: "unavailable" },
    });

    expect(d.action).toBe("retry");
    expect(d.nextAttemptDelayMs).toBe(1 * ONE_MINUTE);
  });

  it("retries a network error with no status at all", () => {
    const d = decideReap({
      hasToken: true,
      attempts: 2,
      outcome: { ok: false, error: "dial tcp timeout" },
    });

    expect(d.action).toBe("retry");
    expect(d.nextAttemptDelayMs).toBe(4 * ONE_MINUTE);
  });

  it("carries the provider error forward so the row explains itself", () => {
    const d = decideReap({
      hasToken: true,
      attempts: 0,
      outcome: { ok: false, status: 500, error: "boom" },
    });

    expect(d.reason).toContain("boom");
  });
});

// ---------------------------------------------------------------------------
// Ceiling
// ---------------------------------------------------------------------------

describe("decideReap — attempt ceiling", () => {
  it("gives up once the attempt about to be recorded reaches the ceiling", () => {
    const d = decideReap({
      hasToken: true,
      attempts: REAP_MAX_ATTEMPTS - 1,
      outcome: { ok: false, status: 503 },
    });

    expect(d.action).toBe("give_up");
    expect(d.reason).toMatch(/teto|tentativas/i);
  });

  it("still retries one attempt before the ceiling", () => {
    const d = decideReap({
      hasToken: true,
      attempts: REAP_MAX_ATTEMPTS - 2,
      outcome: { ok: false, status: 503 },
    });

    expect(d.action).toBe("retry");
  });

  it("confirms at the ceiling if the provider finally succeeded", () => {
    // Success must never be overridden by the ceiling — otherwise the last
    // attempt's success would be recorded as a give-up and the row would read as
    // an orphan that was actually cleaned.
    const d: ReapDecision = decideReap({
      hasToken: true,
      attempts: REAP_MAX_ATTEMPTS - 1,
      outcome: { ok: true, status: 200 },
    });

    expect(d.action).toBe("confirm");
  });
});
