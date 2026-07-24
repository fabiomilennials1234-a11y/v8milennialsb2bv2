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
    recordBanSignal: vi.fn(async () => {}),
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

/** Build a UazapiError-shaped throw, exactly as UazapiClient.request() raises
 *  on a 4xx (the 463 status survives from the provider to the gate unmasked). */
function uazapiError(
  status: number,
  extra: { provider_code?: string | number; message?: string; raw?: unknown } = {},
) {
  return {
    status,
    provider_code: extra.provider_code,
    message: extra.message ?? "provider rejected",
    raw: extra.raw ?? {},
  };
}

describe("PR-1a — reputation feed on a failed send (P3 disjuntor input)", () => {
  it("feeds record_ban_signal with the numeric code on a 463 and re-throws the ORIGINAL error", async () => {
    const original = uazapiError(463, { message: "temporarily restricted" });
    const doSend = vi.fn(async () => {
      throw original;
    });
    // 'off' would still feed — the feed is not gated by mode (it's the choke,
    // and a would-be-off org still burned a real 463). Use a live mode anyway.
    const deps = makeDeps(state({ mode: "shadow" }));
    await expect(governSend(DB, ctx(), doSend, deps)).rejects.toBe(original);
    expect(deps.recordBanSignal).toHaveBeenCalledTimes(1);
    expect(deps.recordBanSignal).toHaveBeenCalledWith(DB, "inst-1", 463);
    expect(doSend).toHaveBeenCalledTimes(1);
    // a failed send never increments the success ledger.
    expect(deps.incrementAutomationUsage).not.toHaveBeenCalled();
  });

  it("feeds a 429 (real rate-limit) exactly once", async () => {
    const err = uazapiError(429);
    const doSend = vi.fn(async () => {
      throw err;
    });
    const deps = makeDeps(state({ mode: "shadow" }));
    await expect(governSend(DB, ctx(), doSend, deps)).rejects.toBe(err);
    expect(deps.recordBanSignal).toHaveBeenCalledTimes(1);
    expect(deps.recordBanSignal).toHaveBeenCalledWith(DB, "inst-1", 429);
    expect(doSend).toHaveBeenCalledTimes(1);
  });

  it("does NOT feed a 403 — transient 'Invalid token' noise, excluded from the PR-1a feed", async () => {
    // 403 ∈ classifyBanSignal's set but NOT the gate's conservative feed set:
    // an HGE-style transient 'Invalid token' must never quarantine a number.
    const err = uazapiError(403, { message: "Invalid token" });
    const doSend = vi.fn(async () => {
      throw err;
    });
    const deps = makeDeps(state({ mode: "shadow" }));
    await expect(governSend(DB, ctx(), doSend, deps)).rejects.toBe(err);
    expect(deps.recordBanSignal).not.toHaveBeenCalled();
    expect(doSend).toHaveBeenCalledTimes(1);
  });

  it("does NOT feed a 500 whose BODY looks ban-ish ('rate limited') — status, not body, gates the feed", async () => {
    // classifyBanSignal(500, ...) WOULD return isBanSignal via the body match;
    // the gate must ignore that and feed ONLY on a strong status (463/429), so a
    // server error can never masquerade as a ban and over-count the feed.
    const err = uazapiError(500, {
      message: "rate limited",
      raw: { error: "rate limited, please try again later" },
    });
    const doSend = vi.fn(async () => {
      throw err;
    });
    const deps = makeDeps(state({ mode: "shadow" }));
    await expect(governSend(DB, ctx(), doSend, deps)).rejects.toBe(err);
    expect(deps.recordBanSignal).not.toHaveBeenCalled();
    expect(doSend).toHaveBeenCalledTimes(1);
  });

  it("feeds even when the org is 'off' — the feed is mode-independent (an off number still burned a real 463)", async () => {
    // The feed lives in the doSend catch, UNconditional on mode/governed: a
    // would-be-off org that just burned a real 463 must still record it, else
    // PR-1b would flip enforce blind. off keeps zero DECISION footprint (no
    // recordDecision / no ledger) but the reputation feed still fires.
    const err = uazapiError(463);
    const doSend = vi.fn(async () => {
      throw err;
    });
    const deps = makeDeps(state({ mode: "off" }));
    await expect(governSend(DB, ctx(), doSend, deps)).rejects.toBe(err);
    expect(deps.recordBanSignal).toHaveBeenCalledTimes(1);
    expect(deps.recordBanSignal).toHaveBeenCalledWith(DB, "inst-1", 463);
    expect(deps.recordDecision).not.toHaveBeenCalled();
    expect(deps.incrementAutomationUsage).not.toHaveBeenCalled();
  });

  it("does NOT feed a STRING status ('463') — extractStatusCode only trusts a numeric status", async () => {
    // The real UazapiError always carries a numeric `status`; a string status is
    // a hypothetical non-Uazapi thrower. We keep it conservative: string status
    // with no numeric provider_code → undefined code → no feed. (Contrast: a
    // string provider_code "463" IS coerced — see the test below.)
    const err = { status: "463", message: "restricted" };
    const doSend = vi.fn(async () => {
      throw err;
    });
    const deps = makeDeps(state({ mode: "shadow" }));
    await expect(governSend(DB, ctx(), doSend, deps)).rejects.toBe(err);
    expect(deps.recordBanSignal).not.toHaveBeenCalled();
  });

  it("derives a numeric code from a string provider_code when status is absent", async () => {
    const err = { provider_code: "463", message: "restricted" };
    const doSend = vi.fn(async () => {
      throw err;
    });
    const deps = makeDeps(state({ mode: "shadow" }));
    await expect(governSend(DB, ctx(), doSend, deps)).rejects.toBe(err);
    expect(deps.recordBanSignal).toHaveBeenCalledTimes(1);
    expect(deps.recordBanSignal).toHaveBeenCalledWith(DB, "inst-1", 463);
  });

  it("does NOT feed on a non-ban error (500, no ban-ish body) and re-throws it", async () => {
    const err = uazapiError(500, { message: "Uazapi server error 500" });
    const doSend = vi.fn(async () => {
      throw err;
    });
    const deps = makeDeps(state({ mode: "shadow" }));
    await expect(governSend(DB, ctx(), doSend, deps)).rejects.toBe(err);
    expect(deps.recordBanSignal).not.toHaveBeenCalled();
    expect(doSend).toHaveBeenCalledTimes(1);
  });

  it("does NOT feed a plain network error with no numeric code", async () => {
    const err = new Error("network unreachable");
    const doSend = vi.fn(async () => {
      throw err;
    });
    const deps = makeDeps(state({ mode: "shadow" }));
    await expect(governSend(DB, ctx(), doSend, deps)).rejects.toBe(err);
    expect(deps.recordBanSignal).not.toHaveBeenCalled();
  });

  it("is FAIL-SOFT: a throwing recordBanSignal never masks the send error nor double-sends", async () => {
    const original = uazapiError(463);
    const doSend = vi.fn(async () => {
      throw original;
    });
    const deps = makeDeps(state({ mode: "shadow" }), {
      recordBanSignal: vi.fn(async () => {
        throw new Error("rpc down");
      }),
    });
    // the ORIGINAL 463 propagates, not the feed error.
    await expect(governSend(DB, ctx(), doSend, deps)).rejects.toBe(original);
    expect(doSend).toHaveBeenCalledTimes(1);
  });

  it("does NOT feed a manual send even on a 463 (a human must never quarantine a number)", async () => {
    const err = uazapiError(463);
    const doSend = vi.fn(async () => {
      throw err;
    });
    const deps = makeDeps(state({ mode: "shadow" }));
    await expect(
      governSend(DB, ctx({ category: "manual" }), doSend, deps),
    ).rejects.toBe(err);
    expect(deps.recordBanSignal).not.toHaveBeenCalled();
    expect(doSend).toHaveBeenCalledTimes(1);
  });

  it("does NOT feed when the sending number is unknown (no instanceId to attribute)", async () => {
    const err = uazapiError(463);
    const doSend = vi.fn(async () => {
      throw err;
    });
    const deps = makeDeps(state({ mode: "shadow" }));
    await expect(
      governSend(DB, ctx({ instanceId: null }), doSend, deps),
    ).rejects.toBe(err);
    expect(deps.recordBanSignal).not.toHaveBeenCalled();
  });

  it("does NOT feed on a successful send", async () => {
    const doSend = vi.fn(async () => "SENT");
    const deps = makeDeps(state({ mode: "shadow" }));
    await governSend(DB, ctx(), doSend, deps);
    expect(deps.recordBanSignal).not.toHaveBeenCalled();
  });
});

describe("doSend runs EXACTLY ONCE on every path", () => {
  it("once on allow-success", async () => {
    const doSend = vi.fn(async () => "SENT");
    await governSend(DB, ctx(), doSend, makeDeps(state({ mode: "shadow" })));
    expect(doSend).toHaveBeenCalledTimes(1);
  });

  it("once on a ban throw (feed path)", async () => {
    const err = uazapiError(463);
    const doSend = vi.fn(async () => {
      throw err;
    });
    await expect(
      governSend(DB, ctx(), doSend, makeDeps(state({ mode: "shadow" }))),
    ).rejects.toBe(err);
    expect(doSend).toHaveBeenCalledTimes(1);
  });

  it("once on a non-ban throw", async () => {
    const err = uazapiError(500, { message: "server error" });
    const doSend = vi.fn(async () => {
      throw err;
    });
    await expect(
      governSend(DB, ctx(), doSend, makeDeps(state({ mode: "shadow" }))),
    ).rejects.toBe(err);
    expect(doSend).toHaveBeenCalledTimes(1);
  });

  it("zero on an enforce block (no send to feed)", async () => {
    const doSend = vi.fn(async () => "SENT");
    const deps = makeDeps(
      state({ mode: "enforce", reputation: "quarantined", quarantineUntil: "2026-07-21T14:00:00.000Z" }),
    );
    await governSend(DB, ctx(), doSend, deps);
    expect(doSend).not.toHaveBeenCalled();
    expect(deps.recordBanSignal).not.toHaveBeenCalled();
  });
});
