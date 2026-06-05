/**
 * useUpdateAgentDocument — metadata edit (description / send_when) on saved docs.
 *
 * Asserts the reprocess decision:
 *   - document (PDF) → persist only, NO process-agent-document invoke
 *   - media (image/video) → persist with status=pending + reprocess invoke
 * and that the agent_documents query is invalidated on success.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

function createChainMock() {
  const chain: Record<string, any> = {};
  ["select", "eq", "update", "insert", "delete"].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: null, error: null }).then(resolve, reject);
  return chain;
}

const mockFrom = vi.fn().mockReturnValue(createChainMock());
const mockInvoke = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    functions: { invoke: (...args: any[]) => mockInvoke(...args) },
  },
}));

vi.mock("@/modules/identity", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useUpdateAgentDocument } from "@/modules/copilot/hooks/useAgentDocuments";

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { wrapper, invalidateSpy };
}

describe("useUpdateAgentDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("persists a document edit without reprocessing", async () => {
    const chain = createChainMock();
    mockFrom.mockReturnValue(chain);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useUpdateAgentDocument(), { wrapper });
    result.current.mutate({
      documentId: "doc-1",
      agentId: "agent-1",
      updates: { send_when: "quando pedir catalogo" },
      reprocessMedia: false,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFrom).toHaveBeenCalledWith("copilot_agent_documents");
    const patch = chain.update.mock.calls[0][0];
    expect(patch).toMatchObject({ send_when: "quando pedir catalogo" });
    // Document path must not flip status nor reprocess.
    expect(patch.status).toBeUndefined();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("reprocesses media (status pending + process-agent-document invoke)", async () => {
    const chain = createChainMock();
    mockFrom.mockReturnValue(chain);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useUpdateAgentDocument(), { wrapper });
    result.current.mutate({
      documentId: "media-1",
      agentId: "agent-1",
      updates: { description: "tabela de precos", send_when: "ao perguntar preco" },
      reprocessMedia: true,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const patch = chain.update.mock.calls[0][0];
    expect(patch).toMatchObject({
      description: "tabela de precos",
      send_when: "ao perguntar preco",
      status: "pending",
      error_message: null,
    });
    expect(mockInvoke).toHaveBeenCalledWith("process-agent-document", {
      body: { documentId: "media-1" },
    });
  });

  it("invalidates the agent_documents query on success", async () => {
    mockFrom.mockReturnValue(createChainMock());
    const { wrapper, invalidateSpy } = createWrapper();

    const { result } = renderHook(() => useUpdateAgentDocument(), { wrapper });
    result.current.mutate({
      documentId: "doc-2",
      agentId: "agent-9",
      updates: { send_when: "x" },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agent_documents", "agent-9"] });
  });
});
