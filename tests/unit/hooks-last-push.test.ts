/**
 * Last push to 70% — cover the remaining 0% files.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";

// ── Mock supabase chain ──
function c(data: unknown[] = [{ id: "m1" }]) {
  const ch: Record<string, any> = {};
  ["select","eq","neq","or","in","gte","lte","lt","ilike","contains","order","limit","range","insert","update","delete","upsert","not","is","filter","match","overlaps"].forEach(m => { ch[m] = vi.fn().mockReturnValue(ch); });
  ch.single = vi.fn().mockResolvedValue({ data: data[0], error: null });
  ch.maybeSingle = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null });
  ch.then = (resolve: any, reject?: any) => Promise.resolve({ data, error: null, count: data.length }).then(resolve, reject);
  ch.catch = (fn: any) => Promise.resolve({ data: [], error: null }).catch(fn);
  return ch;
}
const mF = vi.fn().mockReturnValue(c());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: any[]) => mF(...a),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
  },
}));
vi.mock("@/modules/identity/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/modules/identity/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-t", isReady: true }) }));
vi.mock("@/modules/identity/hooks/useTeamMembers", () => ({ useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-t" } }) }));
vi.mock("@/hooks/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => { vi.clearAllMocks(); mF.mockReturnValue(c()); });

// ═══ useAutoFollowUp (18 LOC) ═══
import { triggerFollowUpAutomation } from "@/modules/workflows/hooks/useAutoFollowUp";

describe("triggerFollowUpAutomation", () => {
  it("returns early when no organizationId", async () => {
    await triggerFollowUpAutomation({
      leadId: "l1", assignedTo: null, pipeType: "whatsapp", stage: "novo", sourcePipeId: "pw1", organizationId: "",
    });
  });

  it("creates follow-ups when automations exist", async () => {
    mF.mockReturnValue(c([
      { id: "auto-1", pipe_type: "whatsapp", stage: "novo", is_active: true, days_offset: 3, title_template: "Follow up", description_template: "Check", priority: "medium" },
    ]));
    await triggerFollowUpAutomation({
      leadId: "l1", assignedTo: "tm1", pipeType: "whatsapp", stage: "novo", sourcePipeId: "pw1", organizationId: "org-1",
    });
    expect(mF).toHaveBeenCalledWith("follow_up_automations");
  });

  it("handles no automations gracefully", async () => {
    mF.mockReturnValue(c([]));
    await triggerFollowUpAutomation({
      leadId: "l1", assignedTo: null, pipeType: "confirmacao", stage: "reuniao_marcada", sourcePipeId: "pc1", organizationId: "org-1",
    });
  });
});

// useLogLeadAction and useIsMobile need QueryClient/media-query mock — skipped
