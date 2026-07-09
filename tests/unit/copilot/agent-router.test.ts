/**
 * AgentRouter — routing cascade + LRU cache (extracted from context-loader.ts)
 *
 * Cascade: stage > origin > segment > default > any active > null
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubGlobal("Deno", {
  env: {
    get: (k: string) => ({ SUPABASE_URL: "https://local.test", SUPABASE_SERVICE_ROLE_KEY: "svc-role" }[k]),
    toObject: () => ({}),
  },
  serve: () => {},
});

vi.mock("../../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_n: string, fn: unknown) => fn,
  logError: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
}));
vi.mock("../../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async () => {}),
  redactSecrets: (v: unknown) => v,
}));
vi.mock("../../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn().mockResolvedValue(null),
  getPipeEntriesByLeads: vi.fn().mockResolvedValue([]),
  resolvePipelineId: vi.fn().mockResolvedValue(null),
}));

import { AgentRouter } from "../../../supabase/functions/_shared/copilot/agent-router.ts";

const AGENT_STAGE = { id: "agent-stage", name: "Stage Agent", is_active: true, routing_stages: ["novo_lead"] };
const AGENT_ORIGIN = { id: "agent-origin", name: "Origin Agent", is_active: true, routing_origins: ["meta_ads"] };
const AGENT_DEFAULT = { id: "agent-default", name: "Default Agent", is_active: true, is_default: true };
const AGENT_FALLBACK = { id: "agent-fallback", name: "Fallback Agent", is_active: true, is_default: false };

function buildSupabase(overrides: {
  lead?: any;
  upsell?: any;
  stageAgent?: any;
  originAgent?: any;
  segmentAgent?: any;
  defaultAgent?: any;
  anyAgent?: any;
} = {}) {
  const sb: any = {
    from: vi.fn((table: string) => {
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        overlaps: vi.fn(() => builder),
        contains: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        maybeSingle: vi.fn(() => {
          if (table === "leads") return Promise.resolve({ data: overrides.lead ?? null, error: null });
          if (table === "upsell_clients") return Promise.resolve({ data: overrides.upsell ?? null, error: null });
          if (table === "campanha_leads") return Promise.resolve({ data: null, error: null });
          if (table === "copilot_agents") {
            // Multiple calls to copilot_agents — need to differentiate
            // Uses call count to determine which query is being made
            const eqCalls = builder.eq.mock.calls;
            const hasOverlaps = builder.overlaps.mock.calls.length > 0;
            const hasContains = builder.contains.mock.calls.length > 0;
            const hasIsDefault = eqCalls.some((c: any[]) => c[0] === "is_default" && c[1] === true);

            if (hasOverlaps) return Promise.resolve({ data: overrides.stageAgent ?? null, error: null });
            if (hasContains) {
              const containsCalls = builder.contains.mock.calls;
              const lastContains = containsCalls[containsCalls.length - 1];
              if (lastContains?.[0] === "routing_origins") return Promise.resolve({ data: overrides.originAgent ?? null, error: null });
              return Promise.resolve({ data: overrides.segmentAgent ?? null, error: null });
            }
            if (hasIsDefault) return Promise.resolve({ data: overrides.defaultAgent ?? null, error: null });

            return Promise.resolve({ data: overrides.anyAgent ?? null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }),
      };
      // Reset mock state per .from() call so each chain is independent
      return builder;
    }),
  };
  return sb;
}

describe("AgentRouter", () => {
  beforeEach(() => {
    AgentRouter.clearCache();
  });

  it("routes by stage when lead has matching stage", async () => {
    const sb = buildSupabase({
      lead: { pipe_whatsapp: "novo_lead", origin: "meta_ads", segment: null },
      stageAgent: AGENT_STAGE,
    });

    const router = new AgentRouter(sb, "org-1");
    const result = await router.route("lead-1");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("agent-stage");
  });

  it("falls to origin when stage match fails", async () => {
    const sb = buildSupabase({
      lead: { pipe_whatsapp: "novo_lead", origin: "meta_ads", segment: null },
      stageAgent: null,
      originAgent: AGENT_ORIGIN,
    });

    const router = new AgentRouter(sb, "org-1");
    const result = await router.route("lead-1");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("agent-origin");
  });

  it("falls to default agent when no routing match", async () => {
    const sb = buildSupabase({
      lead: { pipe_whatsapp: "novo_lead", origin: "meta_ads", segment: null },
      stageAgent: null,
      originAgent: null,
      segmentAgent: null,
      defaultAgent: AGENT_DEFAULT,
    });

    const router = new AgentRouter(sb, "org-1");
    const result = await router.route("lead-1");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("agent-default");
  });

  it("falls to any active agent when no default", async () => {
    const sb = buildSupabase({
      lead: { pipe_whatsapp: "novo_lead", origin: null, segment: null },
      defaultAgent: null,
      anyAgent: AGENT_FALLBACK,
    });

    const router = new AgentRouter(sb, "org-1");
    const result = await router.route("lead-1");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("agent-fallback");
  });

  it("returns null when org has no active agents", async () => {
    const sb = buildSupabase({
      lead: null,
      defaultAgent: null,
      anyAgent: null,
    });

    const router = new AgentRouter(sb, "org-1");
    const result = await router.route();

    expect(result).toBeNull();
  });

  describe("cache", () => {
    it("returns cached result on second call", async () => {
      const sb = buildSupabase({ defaultAgent: AGENT_DEFAULT });

      const router = new AgentRouter(sb, "org-1");
      const r1 = await router.route();
      const fromCallCount1 = sb.from.mock.calls.length;

      const r2 = await router.route();
      const fromCallCount2 = sb.from.mock.calls.length;

      expect(r1).toEqual(r2);
      expect(fromCallCount2).toBe(fromCallCount1); // No new queries
    });

    it("bypasses cache when useCache=false", async () => {
      const sb = buildSupabase({ defaultAgent: AGENT_DEFAULT });

      const router = new AgentRouter(sb, "org-1");
      await router.route();
      const callsBefore = sb.from.mock.calls.length;

      await router.route(undefined, { useCache: false });
      expect(sb.from.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
