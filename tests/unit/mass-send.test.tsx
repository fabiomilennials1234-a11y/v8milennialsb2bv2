/**
 * Sprint 6 — mass send hooks + parseCsv utility tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: invokeMock },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

vi.mock("@/modules/identity/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({
    data: { organization_id: "org-a", id: "tm-1", user_id: "u-1" },
  }),
}));

import {
  useCreateMassSend,
  useControlMassSend,
  useRefreshMassSendStatus,
} from "@/hooks/useMassSendJobs";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => invokeMock.mockReset());

describe("useCreateMassSend", () => {
  it("calls mass-send-create", async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, sender_job_id: "j-1", uazapi_sender_id: "uz-1" },
      error: null,
    });
    const { result } = renderHook(() => useCreateMassSend(), { wrapper });
    const out = await result.current.mutateAsync({
      instance_id: "i-1",
      recipients: [{ number: "5511999999999" }],
      template_text: "Hi",
    });
    expect(invokeMock).toHaveBeenCalledWith("mass-send-create", expect.any(Object));
    expect(out.sender_job_id).toBe("j-1");
  });

  it("throws on edge function error", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: "Forbidden" },
    });
    const { result } = renderHook(() => useCreateMassSend(), { wrapper });
    await expect(
      result.current.mutateAsync({
        instance_id: "i-1",
        recipients: [{ number: "5511999999999" }],
      })
    ).rejects.toThrow("Forbidden");
  });
});

describe("useControlMassSend", () => {
  it("sends pause action", async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, status: "paused" },
      error: null,
    });
    const { result } = renderHook(() => useControlMassSend(), { wrapper });
    const out = await result.current.mutateAsync({ job_id: "j-1", action: "pause" });
    expect(invokeMock).toHaveBeenCalledWith("mass-send-control", {
      body: { job_id: "j-1", action: "pause" },
    });
    expect(out.status).toBe("paused");
  });

  it("sends stop action", async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, status: "cancelled" },
      error: null,
    });
    const { result } = renderHook(() => useControlMassSend(), { wrapper });
    await result.current.mutateAsync({ job_id: "j-1", action: "stop" });
    expect(invokeMock.mock.calls[0][1].body.action).toBe("stop");
  });
});

describe("useRefreshMassSendStatus", () => {
  it("sends job_id to mass-send-status", async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, status: "running" },
      error: null,
    });
    const { result } = renderHook(() => useRefreshMassSendStatus(), { wrapper });
    await result.current.mutateAsync("j-1");
    expect(invokeMock).toHaveBeenCalledWith("mass-send-status", { body: { job_id: "j-1" } });
  });
});
