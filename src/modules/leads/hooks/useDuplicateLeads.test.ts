/**
 * useDuplicateLeads / useMergeLeads — cobre o backend que faltava
 * (RPCs find_duplicate_leads + merge_leads, migration 20270725000000).
 *
 * Regressão: a página /duplicados vinha QUEBRADA porque as RPCs nunca
 * existiram e o `as any` mascarava o 404. Estes testes travam o contrato do
 * hook: nome exato da RPC, mapeamento dos args do merge, e propagação REAL
 * do erro (a UI passou a ter branch de erro em vez de engolir como "vazio").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../../../../tests/helpers/hook-test-utils";

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-123" }),
}));

import { useDuplicateLeads, useMergeLeads } from "./useDuplicateLeads";

const sampleGroup = {
  lead_a_id: "a1",
  lead_a_name: "Acme LTDA",
  lead_a_phone: "5511999990000",
  lead_a_email: "contato@acme.com",
  lead_a_company: "Acme",
  lead_b_id: "b1",
  lead_b_name: "Acme Ltda.",
  lead_b_phone: "5511999990000",
  lead_b_email: null,
  lead_b_company: "Acme",
  match_type: "phone",
  similarity: 1,
};

describe("useDuplicateLeads", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("chama find_duplicate_leads com a org do contexto e devolve os grupos", async () => {
    rpcMock.mockResolvedValue({ data: [sampleGroup], error: null });

    const { result } = renderHook(() => useDuplicateLeads(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpcMock).toHaveBeenCalledWith("find_duplicate_leads", {
      p_organization_id: "org-123",
    });
    expect(result.current.data).toEqual([sampleGroup]);
  });

  it("normaliza data nula para lista vazia", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useDuplicateLeads(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("propaga erro da RPC como isError (não engole mais como vazio)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "function public.find_duplicate_leads() does not exist" },
    });

    const { result } = renderHook(() => useDuplicateLeads(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect((result.current.error as { message: string })?.message).toContain(
      "does not exist",
    );
  });
});

describe("useMergeLeads", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("chama merge_leads mapeando keep/merge para p_keep_lead_id/p_merge_lead_id", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useMergeLeads(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({ keep_id: "keep-1", merge_id: "merge-2" });

    expect(rpcMock).toHaveBeenCalledWith("merge_leads", {
      p_keep_lead_id: "keep-1",
      p_merge_lead_id: "merge-2",
    });
  });

  it("propaga erro da RPC de merge (ex.: access_denied cross-tenant)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "access_denied" },
    });

    const { result } = renderHook(() => useMergeLeads(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({ keep_id: "keep-1", merge_id: "merge-2" }),
    ).rejects.toMatchObject({ message: "access_denied" });
  });
});
