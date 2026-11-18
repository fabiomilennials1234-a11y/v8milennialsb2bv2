import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBuscaClientesAgenda } from "./useAgendaContatos";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

// SDK real: o que importa é a URL que sai para o PostgREST.
vi.mock("@/integrations/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient("https://agenda.example.com", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchMock },
    }),
  };
});
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
  useIdentity: () => ({ isReady: true }),
}));
vi.mock("@/modules/analytics/hooks/useEscopoAgenda", () => ({
  useEscopoAgenda: () => ({ somenteMeus: false }),
}));

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  fetchMock.mockReset();
});
afterEach(() => {
  cleanup();
  client.clear();
});

describe("useBuscaClientesAgenda", () => {
  it("manda só nome, empresa e código do ERP — número digitado não vira filtro de telefone", async () => {
    fetchMock.mockResolvedValue(json([]));
    const { result } = renderHook(() => useBuscaClientesAgenda("48 99999-1234"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    const filtroOr = url.searchParams.get("or") ?? "";
    expect(filtroOr).toContain("erp_code.ilike.");
    expect(filtroOr).toContain("name.ilike.");
    expect(filtroOr).toContain("company.ilike.");
    expect(filtroOr).not.toMatch(/phone/);
  });

  it("traz os dados do hover e devolve o cliente já normalizado", async () => {
    fetchMock.mockResolvedValue(
      json([
        {
          id: "l1",
          name: "Razão",
          company: "Fantasia",
          phone: null,
          erp_code: "1042",
          uf: "SC",
          upsell_clients: [{ erp_city: "Jurerê", erp_uf: "SC", erp_owner_name: "Rep", updated_at: null }],
          lead_phones: [{ phone: "5548999991234", is_primary: true, created_at: null }],
        },
      ]),
    );
    const { result } = renderHook(() => useBuscaClientesAgenda("fantasia"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("select")).toMatch(/upsell_clients\(.*\).*lead_phones\(/);
    expect(url.searchParams.get("lead_phones.deleted_at")).toBe("is.null");
    expect(result.current.data?.[0]).toMatchObject({
      erp_code: "1042",
      cidade: "Jurerê",
      representante: "Rep",
      telefones: ["5548999991234"],
    });
  });
});
