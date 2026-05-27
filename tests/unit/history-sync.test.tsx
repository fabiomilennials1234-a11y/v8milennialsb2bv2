/**
 * Sprint 2 — history-sync unit tests.
 *
 * Covers:
 *  - useCreateHistorySyncJob: validates scope/chat_jid requirement and
 *    default values
 *  - SyncProgressCard: renders each status correctly
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";

// Stub supabase client before importing hooks
const insertMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: insertMock,
      update: updateMock,
    })),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/modules/identity/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({
    data: { organization_id: "org-a", id: "tm-1", user_id: "u-1" },
  }),
}));

import {
  useCreateHistorySyncJob,
  type HistorySyncJob,
} from "@/modules/communication/hooks/useHistorySyncJobs";
import { SyncProgressCard } from "@/modules/communication/components/chat/history-sync/SyncProgressCard";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  insertMock.mockReset();
  updateMock.mockReset();
});

describe("useCreateHistorySyncJob", () => {
  it("rejects scope=chat without chat_jid", async () => {
    const { result } = renderHook(() => useCreateHistorySyncJob(), { wrapper });
    await expect(
      result.current.mutateAsync({
        instance_id: "inst-1",
        scope: "chat",
      })
    ).rejects.toThrow(/chat_jid/);
  });

  it("defaults max_days=30 for scope=default", async () => {
    insertMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "j-1" }, error: null }),
    });
    const { result } = renderHook(() => useCreateHistorySyncJob(), { wrapper });
    await result.current.mutateAsync({
      instance_id: "inst-1",
      scope: "default",
    });
    expect(insertMock).toHaveBeenCalledOnce();
    const payload = insertMock.mock.calls[0][0];
    expect(payload.max_days).toBe(30);
    expect(payload.scope).toBe("default");
    expect(payload.status).toBe("queued");
  });

  it("defaults max_days=0 for scope=full", async () => {
    insertMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "j-1" }, error: null }),
    });
    const { result } = renderHook(() => useCreateHistorySyncJob(), { wrapper });
    await result.current.mutateAsync({
      instance_id: "inst-1",
      scope: "full",
    });
    const payload = insertMock.mock.calls[0][0];
    expect(payload.max_days).toBe(0);
  });
});

describe("SyncProgressCard", () => {
  const baseJob: HistorySyncJob = {
    id: "j-1",
    organization_id: "org-a",
    instance_id: "inst-1",
    chat_jid: null,
    scope: "default",
    max_days: 30,
    max_messages_per_chat: 500,
    max_chats: 100,
    cursor: null,
    status: "queued",
    total_fetched: 0,
    error: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-04-23T00:00:00Z",
    updated_at: "2026-04-23T00:00:00Z",
  };

  it("renders queued state", () => {
    render(<SyncProgressCard job={baseJob} />, { wrapper });
    expect(screen.getByText("Sync padrão (30d)")).toBeInTheDocument();
    expect(screen.getByText("queued")).toBeInTheDocument();
    expect(screen.getByLabelText("Cancelar job")).toBeInTheDocument();
  });

  it("renders running with progress", () => {
    render(
      <SyncProgressCard
        job={{ ...baseJob, status: "running", total_fetched: 250, started_at: "2026-04-23T00:00:00Z" }}
      />,
      { wrapper }
    );
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText(/250 mensagens/)).toBeInTheDocument();
  });

  it("renders completed + final count", () => {
    render(
      <SyncProgressCard
        job={{
          ...baseJob,
          status: "completed",
          total_fetched: 1500,
          started_at: "2026-04-23T00:00:00Z",
          completed_at: "2026-04-23T00:05:00Z",
        }}
      />,
      { wrapper }
    );
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText(/1500 mensagens/)).toBeInTheDocument();
  });

  it("renders failed state with error + retry button", () => {
    render(
      <SyncProgressCard
        job={{
          ...baseJob,
          status: "failed",
          error: "historySync fetch failed: timeout",
        }}
      />,
      { wrapper }
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("timeout");
    expect(screen.getByRole("button", { name: /Retentar/i })).toBeInTheDocument();
  });

  it("renders chat scope label with jid", () => {
    render(
      <SyncProgressCard
        job={{ ...baseJob, scope: "chat", chat_jid: "5511999999999@c.us" }}
      />,
      { wrapper }
    );
    expect(screen.getByText(/Chat específico:.*5511999999999@c\.us/)).toBeInTheDocument();
  });
});
