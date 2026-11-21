import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), notify: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("sonner", () => ({ toast: { success: h.toast } }));
vi.mock("@/shared/errors", () => ({ notifyError: h.notify }));

import { useVincularNumeroALead } from "./useVincularNumeroALead";

function montar() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const r = renderHook(() => useVincularNumeroALead(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  return { ...r, invalidate };
}

beforeEach(() => vi.clearAllMocks());

describe("useVincularNumeroALead", () => {
  it("chama a RPC com org, número e cliente, e atualiza ficha e lista do chat", async () => {
    h.rpc.mockResolvedValue({ data: 3, error: null });
    const { result, invalidate } = montar();
    await act(async () => {
      await result.current.mutateAsync({ phone: "5548922220000", leadId: "lead-erp", leadName: "Cliente ERP" });
    });
    expect(h.rpc).toHaveBeenCalledWith("vincular_numero_a_lead", {
      p_organization_id: "org-1",
      p_phone: "5548922220000",
      p_lead_id: "lead-erp",
    });
    const chaves = invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey[0]);
    expect(chaves).toEqual(expect.arrayContaining(["lead_by_phone", "whatsapp_conversations"]));
    expect(h.toast).toHaveBeenCalledWith("Conversa vinculada a Cliente ERP");
  });

  it("erro da RPC vira aviso e não finge sucesso", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "Cliente não encontrado." } });
    const { result } = montar();
    await act(async () => {
      await expect(result.current.mutateAsync({ phone: "5548922220000", leadId: "x" })).rejects.toBeTruthy();
    });
    expect(h.toast).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalled();
  });
});
