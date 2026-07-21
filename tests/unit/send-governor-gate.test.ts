// @vitest-environment node
/**
 * Send Governor — gate orchestration (governSend). Proves the sacred contracts:
 *  - FAIL-OPEN: any governor error (state read OR evaluation) still runs doSend.
 *  - doSend runs EXACTLY ONCE (no double-send, even on fail-open).
 *  - manual is never blocked.
 *  - SHADOW never blocks (doSend runs, real result returned).
 *  - ENFORCE block/defer returns a SkippedSend WITHOUT sending.
 *  - the usage ledger increments ONLY after a real successful automation send.
 *
 * The io/core layer is injected (governSend's 4th param) so no DB is touched.
 */

import { describe, it, expect, vi } from "vitest";

const { governSend, isSkippedSend } = await import(
  "../../supabase/functions/_shared/send-governor/gate.ts"
);
const { evaluateSend } = await import(
  "../../supabase/functions/_shared/send-governor/core.ts"
);

type Ctx = import("../../supabase/functions/_shared/send-governor/types.ts").GovernorContext;
type State = import("../../supabase/functions/_shared/send-governor/types.ts").GovernorState;

const NOW = "2026-07-21T12:00:00.000Z";
const DB = {} as import("../../supabase/functions/_shared/send-governor/types.ts").GovernorSupabaseClient;

function ctx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    orgId: "org-1",
    instanceId: "inst-1",
    category: "automation",
    recipientPhone: "5511999999999",
    ...overrides,
  };
}

function state(overrides: Partial<State> = {}): State {
  return {
    mode: "enforce",
    warmupEnabled: false,
    coldGateEnabled: false,
    usedToday: 0,
    instanceCap: 80,
    instanceAgeDays: 30,
    reputation: "healthy",
    quarantineUntil: null,
    isColdContact: false,
    nowIso: NOW,
    ...overrides,
  };
}

/** Build an injectable deps object: real evaluateSend, spies for the rest,
 *  resolveGovernorState returning `st` by default. Override as needed. */
function makeDeps(st: State, overrides: Record<string, unknown> = {}) {
  return {
    resolveGovernorState: vi.fn(async () => st),
    evaluateSend,
    recordDecision: vi.fn(async () => {}),
    incrementAutomationUsage: vi.fn(async () => {}),
    ...overrides,
  } as any;
}

describe("FAIL-OPEN — governor errors never stop the send", () => {
  it("runs doSend when resolveGovernorState throws, and leaves the ledger untouched", async () => {
    const doSend = vi.fn(async () => "SENT");
    const deps = makeDeps(state(), {
      resolveGovernorState: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const r = await governSend(DB, ctx(), doSend, deps);
    expect(r).toBe("SENT");
    expect(doSend).toHaveBeenCalledTimes(1);
    // fail-open must not write governor state (mode is unknown).
    expect(deps.incrementAutomationUsage).not.toHaveBeenCalled();
  });

  it("runs doSend when evaluateSend throws", async () => {
    const doSend = vi.fn(async () => "SENT");
    const deps = makeDeps(state(), {
      evaluateSend: vi.fn(() => {
        throw new Error("boom");
      }),
    });
    const r = await governSend(DB, ctx(), doSend, deps);
    expect(r).toBe("SENT");
    expect(doSend).toHaveBeenCalledTimes(1);
  });

  it("runs doSend when recordDecision throws (telemetry is not a gate)", async () => {
    const doSend = vi.fn(async () => "SENT");
    const deps = makeDeps(state({ mode: "shadow" }), {
      recordDecision: vi.fn(async () => {
        throw new Error("log fail");
      }),
    });
    const r = await governSend(DB, ctx(), doSend, deps);
    expect(r).toBe("SENT");
    expect(doSend).toHaveBeenCalledTimes(1);
  });

  it("never double-sends: doSend is called exactly once on fail-open", async () => {
    const doSend = vi.fn(async () => "SENT");
    const deps = makeDeps(state(), {
      resolveGovernorState: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await governSend(DB, ctx(), doSend, deps);
    expect(doSend).toHaveBeenCalledTimes(1);
  });
});

describe("manual is never blocked", () => {
  it("sends a manual message even in enforce + quarantined", async () => {
    const doSend = vi.fn(async () => "SENT");
    const deps = makeDeps(
      state({ mode: "enforce", reputation: "quarantined", quarantineUntil: "2026-07-21T14:00:00.000Z" }),
    );
    const r = await governSend(DB, ctx({ category: "manual" }), doSend, deps);
    expect(r).toBe("SENT");
    expect(doSend).toHaveBeenCalledTimes(1);
    expect(isSkippedSend(r)).toBe(false);
    // manual is not automation → no usage increment
    expect(deps.incrementAutomationUsage).not.toHaveBeenCalled();
  });
});

describe("SHADOW never blocks", () => {
  it("sends despite a would-be block, returns the real doSend result", async () => {
    const doSend = vi.fn(async () => ({ message_id: "m1" }));
    const deps = makeDeps(
      state({ mode: "shadow", reputation: "quarantined", quarantineUntil: "2026-07-21T14:00:00.000Z" }),
    );
    const r = await governSend(DB, ctx(), doSend, deps);
    expect(r).toEqual({ message_id: "m1" });
    expect(doSend).toHaveBeenCalledTimes(1);
    expect(isSkippedSend(r)).toBe(false);
    // shadow, non-manual → decision is recorded
    expect(deps.recordDecision).toHaveBeenCalledTimes(1);
  });
});

describe("ENFORCE block/defer skips the send", () => {
  it("returns a SkippedSend (block) without calling doSend", async () => {
    const doSend = vi.fn(async () => "SENT");
    const deps = makeDeps(
      state({ mode: "enforce", reputation: "quarantined", quarantineUntil: "2026-07-21T14:00:00.000Z" }),
    );
    const r = await governSend(DB, ctx(), doSend, deps);
    expect(isSkippedSend(r)).toBe(true);
    expect((r as any).action).toBe("block");
    expect((r as any).reason).toBe("quarantined");
    expect(doSend).not.toHaveBeenCalled();
    expect(deps.incrementAutomationUsage).not.toHaveBeenCalled();
  });

  it("returns a SkippedSend (defer) at the per-number cap", async () => {
    const doSend = vi.fn(async () => "SENT");
    const deps = makeDeps(state({ mode: "enforce", usedToday: 80, instanceCap: 80 }));
    const r = await governSend(DB, ctx(), doSend, deps);
    expect(isSkippedSend(r)).toBe(true);
    expect((r as any).action).toBe("defer");
    expect((r as any).reason).toBe("per_number_cap");
    expect((r as any).retryAt).toBeTruthy();
    expect(doSend).not.toHaveBeenCalled();
  });
});

describe("usage ledger increments ONLY after a real successful send", () => {
  it("increments once on a successful automation send (allow)", async () => {
    const doSend = vi.fn(async () => "SENT");
    const deps = makeDeps(state({ mode: "shadow" }));
    await governSend(DB, ctx(), doSend, deps);
    expect(deps.incrementAutomationUsage).toHaveBeenCalledTimes(1);
    expect(deps.incrementAutomationUsage).toHaveBeenCalledWith(DB, "inst-1");
  });

  it("does NOT increment when doSend throws (propagates the error)", async () => {
    const doSend = vi.fn(async () => {
      throw new Error("send failed");
    });
    const deps = makeDeps(state({ mode: "shadow" }));
    await expect(governSend(DB, ctx(), doSend, deps)).rejects.toThrow("send failed");
    expect(deps.incrementAutomationUsage).not.toHaveBeenCalled();
  });

  it("does NOT increment for a manual send", async () => {
    const doSend = vi.fn(async () => "SENT");
    const deps = makeDeps(state({ mode: "shadow" }));
    await governSend(DB, ctx({ category: "manual" }), doSend, deps);
    expect(deps.incrementAutomationUsage).not.toHaveBeenCalled();
  });

  it("does NOT increment when the sending number is unknown", async () => {
    const doSend = vi.fn(async () => "SENT");
    const deps = makeDeps(state({ mode: "shadow" }));
    await governSend(DB, ctx({ instanceId: null }), doSend, deps);
    expect(deps.incrementAutomationUsage).not.toHaveBeenCalled();
  });

  it("does NOT increment a blocked send (enforce)", async () => {
    const doSend = vi.fn(async () => "SENT");
    const deps = makeDeps(
      state({ mode: "enforce", reputation: "quarantined", quarantineUntil: "2026-07-21T14:00:00.000Z" }),
    );
    await governSend(DB, ctx(), doSend, deps);
    expect(deps.incrementAutomationUsage).not.toHaveBeenCalled();
  });
});

describe("telemetry gating", () => {
  it("does not record a decision when the org is 'off'", async () => {
    const doSend = vi.fn(async () => "SENT");
    const deps = makeDeps(state({ mode: "off" }));
    await governSend(DB, ctx(), doSend, deps);
    expect(deps.recordDecision).not.toHaveBeenCalled();
    expect(doSend).toHaveBeenCalledTimes(1);
    // an inert org keeps zero governor footprint — no ledger write either.
    expect(deps.incrementAutomationUsage).not.toHaveBeenCalled();
  });
});
