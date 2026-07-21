// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

import {
  pickJitterInterval,
  pickJitterTarget,
  computeJitterWait,
  clampDeferUntil,
  shouldFailOpen,
  quietHoursDeferUntil,
  nextMidnightUtc,
  mergeGovernorConfig,
  isQuietHoursExempt,
  governOutboundSend,
  commitOutboundSend,
  MIN_DEFER_LEAD_MS,
  type GovernorConfig,
  type QuietHoursConfig,
} from "../../../supabase/functions/_shared/action-handlers/send-governor";
import { JITTER_MIN_MS, JITTER_MAX_MS } from "../../../supabase/functions/_shared/anti-ban-jitter";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build an enabled config; pass raw JSONB overrides to isolate a lever. */
function cfg(raw: Record<string, unknown> = {}, budget = 200): GovernorConfig {
  return mergeGovernorConfig(true, raw, budget);
}

const ALL_OFF = {
  jitter: { mode: "off" },
  instance_cap: { mode: "off" },
  org_cap: { mode: "off" },
  quiet_hours: { mode: "off" },
};

const QUIET: QuietHoursConfig = {
  mode: "enforce",
  days: [1, 2, 3, 4, 5, 6],
  fromMinutes: 480, // 08:00
  toMinutes: 1200, // 20:00
  morningSpreadMaxMin: 90,
  timezone: "America/Sao_Paulo",
};

// A deterministic instant: Wed 2026-07-22 03:00 BRT (= 06:00 UTC), before window open.
const WED_0300_BRT = new Date("2026-07-22T06:00:00Z");
// Wed 2026-07-22 12:00 BRT (= 15:00 UTC), inside the 08:00–20:00 window.
const WED_1200_BRT = new Date("2026-07-22T15:00:00Z");

// ═══ Pure helpers ═════════════════════════════════════════════════════════════

describe("pickJitterInterval", () => {
  it("returns the min at rng=0 and the max at rng→1", () => {
    expect(pickJitterInterval(3000, 8000, () => 0)).toBe(3000);
    expect(pickJitterInterval(3000, 8000, () => 0.999999)).toBe(8000);
  });
  it("stays within [min,max] across the range", () => {
    for (let i = 0; i <= 20; i++) {
      const v = pickJitterInterval(3000, 8000, () => i / 20);
      expect(v).toBeGreaterThanOrEqual(3000);
      expect(v).toBeLessThanOrEqual(8000);
    }
  });
  it("never returns below min when max < min (defensive)", () => {
    expect(pickJitterInterval(8000, 3000, () => 0.5)).toBe(8000);
  });
});

describe("pickJitterTarget (Onda 0 reuse)", () => {
  // Reconciliation: the DEFAULT range delegates to anti-ban-jitter.jitterDelayMs,
  // which is [JITTER_MIN_MS, JITTER_MAX_MS) — max EXCLUSIVE — so a workflow send
  // jitters identically to the mass/cron workers.
  it("delegates the default range to the shared jitter (max exclusive)", () => {
    const j = { minMs: JITTER_MIN_MS, maxMs: JITTER_MAX_MS };
    expect(pickJitterTarget(j, () => 0)).toBe(JITTER_MIN_MS);
    // rng→1 stays strictly below max (exclusive), unlike the inclusive picker.
    expect(pickJitterTarget(j, () => 0.999999)).toBeLessThan(JITTER_MAX_MS);
    expect(pickJitterTarget(j, () => 0.999999)).toBe(JITTER_MAX_MS - 1);
  });
  it("uses the config-driven inclusive picker when the org tuned the range", () => {
    const j = { minMs: 2000, maxMs: 5000 };
    expect(pickJitterTarget(j, () => 0)).toBe(2000);
    expect(pickJitterTarget(j, () => 0.999999)).toBe(5000); // inclusive max
  });
});

describe("computeJitterWait", () => {
  it("is 0 when there is no prior outgoing", () => {
    expect(computeJitterWait(8000, null, 1_000_000)).toBe(0);
  });
  it("is 0 when enough time already elapsed", () => {
    expect(computeJitterWait(8000, 1_000_000 - 9000, 1_000_000)).toBe(0);
  });
  it("is the remaining gap when sends are bunched", () => {
    expect(computeJitterWait(8000, 1_000_000 - 1000, 1_000_000)).toBe(7000);
  });
});

describe("clampDeferUntil (Guard #1)", () => {
  it("pushes a past/near target to now + 60s", () => {
    const now = new Date("2026-07-22T06:00:00Z");
    const past = new Date(now.getTime() + 5000);
    const clamped = clampDeferUntil(past, now);
    expect(clamped.getTime()).toBe(now.getTime() + MIN_DEFER_LEAD_MS);
  });
  it("leaves a safely-future target untouched", () => {
    const now = new Date("2026-07-22T06:00:00Z");
    const far = new Date(now.getTime() + 3_600_000);
    expect(clampDeferUntil(far, now).getTime()).toBe(far.getTime());
  });
});

describe("shouldFailOpen (Guard #2)", () => {
  it("fails open only at/after the threshold", () => {
    expect(shouldFailOpen(4, 5)).toBe(false);
    expect(shouldFailOpen(5, 5)).toBe(true);
    expect(shouldFailOpen(6, 5)).toBe(true);
  });
});

describe("quietHoursDeferUntil + morning spread", () => {
  it("returns null when inside the window (send now)", () => {
    expect(quietHoursDeferUntil(QUIET, WED_1200_BRT, () => 0.5)).toBeNull();
  });
  it("defers to the next window open when before 08:00", () => {
    const d = quietHoursDeferUntil(QUIET, WED_0300_BRT, () => 0)!;
    // Wed 08:00 BRT == 11:00 UTC, spread 0.
    expect(d.toISOString()).toBe("2026-07-22T11:00:00.000Z");
  });
  it("keeps the spread inside [0, morningSpreadMaxMin)", () => {
    const open = new Date("2026-07-22T11:00:00.000Z").getTime();
    const dMax = quietHoursDeferUntil(QUIET, WED_0300_BRT, () => 0.999999)!;
    expect(dMax.getTime()).toBeGreaterThanOrEqual(open);
    expect(dMax.getTime()).toBeLessThan(open + 90 * 60_000);
  });
  it("skips Sunday to Monday open (day not allowed)", () => {
    // Sun 2026-07-19 10:00 BRT == 13:00 UTC. Sunday not in Mon–Sat → next Mon 08:00.
    const sun = new Date("2026-07-19T13:00:00Z");
    const d = quietHoursDeferUntil(QUIET, sun, () => 0)!;
    expect(d.toISOString()).toBe("2026-07-20T11:00:00.000Z");
  });
});

describe("nextMidnightUtc", () => {
  it("returns the next Sao Paulo midnight as UTC (BRT 00:00 == 03:00Z)", () => {
    expect(nextMidnightUtc(WED_0300_BRT, "America/Sao_Paulo").toISOString())
      .toBe("2026-07-23T03:00:00.000Z");
  });
});

describe("mergeGovernorConfig", () => {
  it("defaults every lever to enforce when enabled with no JSONB", () => {
    const c = mergeGovernorConfig(true, null, 200);
    expect(c.enabled).toBe(true);
    expect(c.jitter.mode).toBe("enforce");
    expect(c.instanceCap.mode).toBe("enforce");
    expect(c.orgCap.mode).toBe("enforce");
    expect(c.quietHours.mode).toBe("enforce");
    expect(c.jitter.minMs).toBe(3000);
    expect(c.jitter.maxMs).toBe(8000);
    expect(c.maxDefers).toBe(5);
  });
  it("honours per-lever overrides and coerces invalid modes to the default", () => {
    const c = mergeGovernorConfig(true, {
      jitter: { mode: "shadow", min_ms: 2000, max_ms: 5000 },
      quiet_hours: { mode: "bogus", from_minutes: 540 },
    }, 200);
    expect(c.jitter.mode).toBe("shadow");
    expect(c.jitter.minMs).toBe(2000);
    expect(c.jitter.maxMs).toBe(5000);
    expect(c.quietHours.mode).toBe("enforce"); // "bogus" → default
    expect(c.quietHours.fromMinutes).toBe(540);
  });
  it("carries enabled=false through untouched", () => {
    expect(mergeGovernorConfig(false, null, 200).enabled).toBe(false);
  });
});

describe("isQuietHoursExempt", () => {
  it("exempts operator hand-off and reminders only", () => {
    expect(isQuietHoursExempt("operator_notification")).toBe(true);
    expect(isQuietHoursExempt("reminder")).toBe(true);
    expect(isQuietHoursExempt("automation")).toBe(false);
    expect(isQuietHoursExempt("campaign")).toBe(false);
  });
});

// ═══ Orchestrator ═════════════════════════════════════════════════════════════

function baseInput(overrides: Partial<Parameters<typeof governOutboundSend>[0]> = {}) {
  const { sb } = createMockSupabase();
  return {
    supabase: sb,
    organizationId: "org-1",
    instanceId: "inst-1",
    instanceCapRaw: 80,
    nodeId: "node-1",
    deferCount: 0,
    sendClass: "automation" as const,
    config: cfg(ALL_OFF),
    now: WED_1200_BRT,
    ...overrides,
  };
}

describe("governOutboundSend — master flag", () => {
  it("flag OFF is a no-op: always sends, never reads caps", async () => {
    const readInstanceUsage = vi.fn();
    const d = await governOutboundSend(baseInput({
      config: mergeGovernorConfig(false, null, 200),
      readInstanceUsage,
    }));
    expect(d.decision).toBe("send");
    expect(d.deferUntil).toBeUndefined();
    expect(readInstanceUsage).not.toHaveBeenCalled();
  });
});

describe("governOutboundSend — fail-open (Guard #2)", () => {
  it("sends once the node hit the defer ceiling, even if caps say defer", async () => {
    const d = await governOutboundSend(baseInput({
      deferCount: 5,
      config: cfg({ ...ALL_OFF, instance_cap: { mode: "enforce" } }),
      readInstanceUsage: async () => ({ ok: true, used: 9999 }),
    }));
    expect(d.decision).toBe("send");
    expect(d.reason).toBe("fail_open_max_defers");
  });
});

describe("governOutboundSend — instance cap", () => {
  it("defers to next BRT midnight when the number is exhausted", async () => {
    const d = await governOutboundSend(baseInput({
      now: WED_0300_BRT,
      config: cfg({ ...ALL_OFF, instance_cap: { mode: "enforce" } }),
      readInstanceUsage: async () => ({ ok: true, used: 80 }),
    }));
    expect(d.decision).toBe("defer");
    expect(d.reason).toContain("instance_cap");
    expect(d.deferUntil).toBe("2026-07-23T03:00:00.000Z");
  });
  it("a READ error defers SHORT (minutes), never till reset (Guard #3)", async () => {
    const d = await governOutboundSend(baseInput({
      now: WED_1200_BRT,
      config: cfg({ ...ALL_OFF, instance_cap: { mode: "enforce" } }),
      readInstanceUsage: async () => ({ ok: false }),
    }));
    expect(d.decision).toBe("defer");
    expect(d.reason).toContain("instance_cap_read_error");
    const deltaMin = (new Date(d.deferUntil!).getTime() - WED_1200_BRT.getTime()) / 60000;
    expect(deltaMin).toBeLessThanOrEqual(6);
    expect(deltaMin).toBeGreaterThanOrEqual(1);
  });
  it("shadow mode observes but never defers", async () => {
    const d = await governOutboundSend(baseInput({
      config: cfg({ ...ALL_OFF, instance_cap: { mode: "shadow" } }),
      readInstanceUsage: async () => ({ ok: true, used: 9999 }),
      getLastOutgoing: async () => null,
    }));
    expect(d.decision).toBe("send");
  });
});

describe("governOutboundSend — org cap", () => {
  it("defers when the org daily budget is spent", async () => {
    const d = await governOutboundSend(baseInput({
      now: WED_0300_BRT,
      config: cfg({ ...ALL_OFF, org_cap: { mode: "enforce" } }, 200),
      readOrgUsage: async () => ({ ok: true, used: 200 }),
    }));
    expect(d.decision).toBe("defer");
    expect(d.reason).toContain("org_cap");
  });
});

describe("governOutboundSend — quiet hours", () => {
  it("defers madrugada sends to the morning window", async () => {
    const d = await governOutboundSend(baseInput({
      now: WED_0300_BRT,
      config: cfg({ ...ALL_OFF, quiet_hours: { mode: "enforce" } }),
    }));
    expect(d.decision).toBe("defer");
    expect(d.reason).toContain("quiet_hours");
    expect(new Date(d.deferUntil!).getTime()).toBeGreaterThan(WED_0300_BRT.getTime());
  });
  it("operator hand-off is exempt from quiet hours", async () => {
    const d = await governOutboundSend(baseInput({
      now: WED_0300_BRT,
      sendClass: "operator_notification",
      config: cfg({ ...ALL_OFF, quiet_hours: { mode: "enforce" } }),
      getLastOutgoing: async () => null,
    }));
    expect(d.decision).toBe("send");
  });
});

describe("governOutboundSend — jitter", () => {
  it("sends immediately when the last outgoing is old enough", async () => {
    const d = await governOutboundSend(baseInput({
      config: cfg({ ...ALL_OFF, jitter: { mode: "enforce" } }),
      rng: () => 0, // target 3000ms
      getLastOutgoing: async () => WED_1200_BRT.getTime() - 100_000,
    }));
    expect(d.decision).toBe("send");
  });
  it("defers a bunched send and clamps deferUntil to >= now + 60s (Guard #1)", async () => {
    const d = await governOutboundSend(baseInput({
      config: cfg({ ...ALL_OFF, jitter: { mode: "enforce" } }),
      rng: () => 0.999999, // target ~8000ms
      getLastOutgoing: async () => WED_1200_BRT.getTime() - 1, // ~8s still owed
    }));
    expect(d.decision).toBe("defer");
    expect(d.reason).toBe("jitter");
    // Raw wait ~8s → clamped up to the 60s floor.
    expect(new Date(d.deferUntil!).getTime()).toBe(WED_1200_BRT.getTime() + MIN_DEFER_LEAD_MS);
  });
});

describe("governOutboundSend — no WhatsApp instance (Meta path)", () => {
  it("skips WhatsApp-only levers, still applies quiet hours", async () => {
    const readInstanceUsage = vi.fn();
    const d = await governOutboundSend(baseInput({
      instanceId: undefined,
      now: WED_0300_BRT,
      config: cfg({ ...ALL_OFF, instance_cap: { mode: "enforce" }, quiet_hours: { mode: "enforce" } }),
      readInstanceUsage,
    }));
    expect(d.decision).toBe("defer");
    expect(d.reason).toContain("quiet_hours");
    expect(readInstanceUsage).not.toHaveBeenCalled(); // no instance → no cap read
  });
});

// ═══ Commit ══════════════════════════════════════════════════════════════════

describe("commitOutboundSend", () => {
  function fakeSources() {
    const incInst = vi.fn().mockResolvedValue(undefined);
    const incOrg = vi.fn().mockResolvedValue(undefined);
    return {
      incInst,
      incOrg,
      instanceUsage: { getUsedToday: vi.fn(), increment: incInst },
      orgUsage: { getUsedToday: vi.fn(), increment: incOrg },
    };
  }

  it("increments both ledgers by 1 when both caps enforce", async () => {
    const { sb } = createMockSupabase();
    const f = fakeSources();
    await commitOutboundSend({
      supabase: sb, organizationId: "org-1", instanceId: "inst-1",
      config: cfg({ ...ALL_OFF, instance_cap: { mode: "enforce" }, org_cap: { mode: "enforce" } }),
      instanceUsage: f.instanceUsage, orgUsage: f.orgUsage,
    });
    expect(f.incInst).toHaveBeenCalledWith("inst-1", expect.any(String), 1);
    expect(f.incOrg).toHaveBeenCalledWith("org-1", expect.any(String), 1);
  });

  it("does NOT increment for a shadow lever", async () => {
    const { sb } = createMockSupabase();
    const f = fakeSources();
    await commitOutboundSend({
      supabase: sb, organizationId: "org-1", instanceId: "inst-1",
      config: cfg({ ...ALL_OFF, instance_cap: { mode: "shadow" }, org_cap: { mode: "shadow" } }),
      instanceUsage: f.instanceUsage, orgUsage: f.orgUsage,
    });
    expect(f.incInst).not.toHaveBeenCalled();
    expect(f.incOrg).not.toHaveBeenCalled();
  });

  it("is a no-op when the master flag is off", async () => {
    const { sb } = createMockSupabase();
    const f = fakeSources();
    await commitOutboundSend({
      supabase: sb, organizationId: "org-1", instanceId: "inst-1",
      config: mergeGovernorConfig(false, null, 200),
      instanceUsage: f.instanceUsage, orgUsage: f.orgUsage,
    });
    expect(f.incInst).not.toHaveBeenCalled();
    expect(f.incOrg).not.toHaveBeenCalled();
  });

  it("is a no-op when there is no WhatsApp instance (Meta)", async () => {
    const { sb } = createMockSupabase();
    const f = fakeSources();
    await commitOutboundSend({
      supabase: sb, organizationId: "org-1", instanceId: undefined,
      config: cfg({ ...ALL_OFF, instance_cap: { mode: "enforce" }, org_cap: { mode: "enforce" } }),
      instanceUsage: f.instanceUsage, orgUsage: f.orgUsage,
    });
    expect(f.incInst).not.toHaveBeenCalled();
    expect(f.incOrg).not.toHaveBeenCalled();
  });
});
