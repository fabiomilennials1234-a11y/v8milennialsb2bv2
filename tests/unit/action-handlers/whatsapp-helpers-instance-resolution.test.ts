// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

// Strict (lead-bound) resolution returns null so every case here exercises the
// org-default fallback branch of getWhatsAppInstance.
vi.mock("../../../supabase/functions/_shared/instance-write-guard.ts", () => ({
  resolveStrictInstanceForCaller: vi.fn().mockResolvedValue(null),
  StrictWriteResolutionError: class extends Error { errorCode = "test"; },
}));

vi.mock("../../../supabase/functions/_shared/time-variables.ts", () => ({
  getTimeBasedVariables: vi.fn().mockReturnValue({ saudacao: "Bom dia", data: "19/06/2026", hora: "10:00" }),
}));
vi.mock("../../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn().mockResolvedValue(null),
}));

import { getWhatsAppInstance } from "../../../supabase/functions/_shared/action-handlers/whatsapp-helpers";

const LIVE = {
  id: "inst-live",
  instance_name: "Comercial Vivo",
  organization_id: "org-1",
  status: "connected",
  provider: "uazapi",
  session_dead_since: null,
  last_connection_at: "2026-06-19T12:00:00Z",
};

// status frozen at "connected" — WhatsApp logged out from another device; the
// watchdog stamped session_dead_since. This is the Bertin 1f7bb711 shape.
const DEAD = {
  id: "inst-dead",
  instance_name: "Comercial Morto",
  organization_id: "org-1",
  status: "connected",
  provider: "uazapi",
  session_dead_since: "2026-06-17T13:40:02Z",
  last_connection_at: "2026-06-15T13:21:30Z",
};

describe("getWhatsAppInstance org-default fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips a session-dead instance and picks the live one", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [DEAD, LIVE]);

    const res = await getWhatsAppInstance(sb, "org-1", undefined, null);
    expect(res?.instanceId).toBe("inst-live");
  });

  it("returns null when the only candidate is session-dead", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [DEAD]);

    const res = await getWhatsAppInstance(sb, "org-1", undefined, null);
    expect(res).toBeNull();
  });

  it("prefers the most recently connected live instance", async () => {
    const olderLive = { ...LIVE, id: "inst-older", instance_name: "Antigo", last_connection_at: "2026-06-10T08:00:00Z" };
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [olderLive, LIVE]);

    const res = await getWhatsAppInstance(sb, "org-1", undefined, null);
    expect(res?.instanceId).toBe("inst-live");
  });
});
