// @vitest-environment node
/**
 * whatsapp-session-watchdog — robust-join regression.
 *
 * The watchdog used to map our rows to Uazapi /instance/all only by adminField02
 * (operator-set metadata). When that field was dropped/dirty, a dead session
 * stayed invisible and its "connected" row kept enrolling leads into a dead
 * funnel for days (Bertin d2a12a72). The fix adds the canonical Uazapi instance
 * id (r…) from the secrets table as a second join key, and stops skipping
 * genuinely-ours-but-unmapped instances silently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";

// Stand up Deno (env + serve capture) BEFORE the static import of index.ts —
// ESM evaluates imports before any top-level statement, so this must be hoisted.
const hoist = vi.hoisted(() => {
  const envStore: Record<string, string> = {};
  const capture = { handler: null as null | ((req: Request) => Promise<Response>) };
  (globalThis as any).Deno = {
    env: {
      get: (k: string) => envStore[k] ?? undefined,
      set: (k: string, v: string) => { envStore[k] = v; },
      delete: (k: string) => { delete envStore[k]; },
      toObject: () => ({ ...envStore }),
    },
    serve: (h: any) => { capture.handler = h; return { finished: Promise.resolve() }; },
    resolveDns: async () => [],
  };
  return { capture };
});
const capture = hoist.capture;
const setDenoEnv = (k: string, v: string) => (globalThis as any).Deno.env.set(k, v);

let activeSb: any = null;
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => activeSb,
}));
vi.mock("../../supabase/functions/_shared/sentry.ts", () => ({
  withSentry: (_n: string, h: any) => h,
}));
vi.mock("../../supabase/functions/_shared/cors.ts", () => ({ getCorsHeaders: () => ({}) }));
vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({ withSecurityHeaders: (h: any) => h }));
vi.mock("../../supabase/functions/_shared/auth.ts", () => ({
  timingSafeCompare: (a: string, b: string) => a === b,
}));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({ logRuntime: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../supabase/functions/_shared/whatsapp-owner.ts", () => ({ extractOwnerNumber: () => null }));

import "../../supabase/functions/whatsapp-session-watchdog/index";

const CRON = "test-cron-secret";

function setEnv() {
  setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
  setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
  setDenoEnv("CRON_SECRET", CRON);
  setDenoEnv("UAZAPI_BASE_URL", "https://uaz.test");
  setDenoEnv("UAZAPI_ADMIN_TOKEN", "admin-token");
}

function mockInstanceAll(list: unknown[]) {
  (globalThis as any).fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => list,
  });
}

async function invoke(): Promise<any> {
  const res = await capture.handler!(
    new Request("https://edge/whatsapp-session-watchdog", {
      method: "POST",
      headers: { "x-cron-secret": CRON },
    }),
  );
  return res.json();
}

describe("whatsapp-session-watchdog robust join", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnv();
  });

  it("marks a dead session matched only by uazapi_instance_id (adminField02 absent)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [{
      id: "inst-1", organization_id: "org-1", instance_name: "Bertin",
      provider: "uazapi", status: "connected", phone_number: null,
      session_dead_since: null, session_dead_reason: null,
    }]);
    mockTable("whatsapp_instance_secrets", [{ instance_id: "inst-1", uazapi_instance_id: "rABC123" }]);
    activeSb = sb;

    // adminField02 deliberately missing — only the r-id is present.
    mockInstanceAll([{ id: "rABC123", status: "disconnected", lastDisconnectReason: "primary device was logged out" }]);

    const summary = await invoke();
    expect(summary.transitioned_dead).toBe(1);
    expect(summary.dead).toEqual([{ id: "inst-1", org: "org-1", reason: "primary device was logged out" }]);
  });

  it("counts an ours-but-absent instance as untracked instead of crashing", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [{
      id: "inst-2", organization_id: "org-1", instance_name: "Sumida",
      provider: "uazapi", status: "connected", phone_number: null,
      session_dead_since: null, session_dead_reason: null,
    }]);
    mockTable("whatsapp_instance_secrets", [{ instance_id: "inst-2", uazapi_instance_id: "rZZZ" }]);
    activeSb = sb;

    // Neither adminField02 nor r-id present — instance dropped from Uazapi list.
    mockInstanceAll([{ id: "rOTHER", adminField02: "ffffffff-ffff-ffff-ffff-ffffffffffff", status: "connected" }]);

    const summary = await invoke();
    expect(summary.untracked_on_uazapi).toBe(1);
    expect(summary.transitioned_dead).toBe(0);
  });

  it("still resolves via adminField02 when present", async () => {
    // adminField02 carries the real 36-char uuid of our instance row.
    const uuid = "33333333-3333-3333-3333-333333333333";
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [{
      id: uuid, organization_id: "org-1", instance_name: "Legada",
      provider: "uazapi", status: "connected", phone_number: null,
      session_dead_since: null, session_dead_reason: null,
    }]);
    mockTable("whatsapp_instance_secrets", [{ instance_id: uuid, uazapi_instance_id: "rOLD" }]);
    activeSb = sb;

    mockInstanceAll([{ id: "rNEW-not-synced", adminField02: uuid, status: "disconnected", lastDisconnectReason: "banned" }]);

    const summary = await invoke();
    expect(summary.transitioned_dead).toBe(1);
    expect(summary.dead[0].id).toBe(uuid);
  });
});
