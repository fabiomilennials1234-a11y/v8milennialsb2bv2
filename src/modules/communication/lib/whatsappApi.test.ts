import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---
// supabase.functions.invoke is the boundary we assert against: getMessageLimits
// must forward organization_id into the proxy body so the whatsapp-api-proxy
// receives the org of the *viewed* instance (not the localStorage fallback).
const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

import { getMessageLimits } from "./whatsappApi";

const okResult = { current: 12, limit: 80 };

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: { ok: true, result: okResult }, error: null });
  // Keep localStorage clean so fallback behavior is observable.
  try {
    localStorage.removeItem("selected_org_id");
  } catch {
    /* jsdom always has localStorage; guard for safety */
  }
});

describe("getMessageLimits", () => {
  it("forwards organization_id into the proxy body when provided", async () => {
    const result = await getMessageLimits("inst-1", "org-abc");

    expect(result).toEqual(okResult);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [fn, opts] = invokeMock.mock.calls[0];
    expect(fn).toBe("whatsapp-api-proxy");
    expect(opts.body).toMatchObject({
      action: "getMessageLimits",
      instance_id: "inst-1",
      organization_id: "org-abc",
    });
  });

  it("omits organization_id (legacy fallback) when no org is passed and none stored", async () => {
    await getMessageLimits("inst-1");

    const [, opts] = invokeMock.mock.calls[0];
    expect(opts.body.action).toBe("getMessageLimits");
    expect(opts.body.instance_id).toBe("inst-1");
    // No explicit org and no localStorage entry → org stays absent (fallback path).
    expect(opts.body.organization_id).toBeUndefined();
  });

  it("preserves legacy localStorage fallback when no org is passed", async () => {
    localStorage.setItem("selected_org_id", "org-stored");

    await getMessageLimits("inst-1");

    const [, opts] = invokeMock.mock.calls[0];
    expect(opts.body.organization_id).toBe("org-stored");
  });
});
