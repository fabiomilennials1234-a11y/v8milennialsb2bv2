import React from "react";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ org: "4922638c-4909-494e-ba10-12282ec0b161", flag: true, from: vi.fn() }));
vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: mocks.org }) }));
vi.mock("@/modules/platform", () => ({ useFeatureFlag: () => ({ enabled: mocks.flag, isLoading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
import { useCafeJurereCadastro } from "./useCafeJurereCadastro";

afterEach(() => { cleanup(); mocks.from.mockReset(); mocks.org = "4922638c-4909-494e-ba10-12282ec0b161"; mocks.flag = true; });
function setup(enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useCafeJurereCadastro("lead-test", enabled), { wrapper });
}
describe("consulta cadastral restrita ao piloto", () => {
  it("filtra organização, vínculo do lead e fornecedor; desliga até o dado em cache", async () => {
    const builder = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { external_id: "1" }, error: null }) };
    mocks.from.mockReturnValue(builder);
    const hook = setup();
    await waitFor(() => expect(hook.result.current.data?.external_id).toBe("1"));
    expect(builder.eq.mock.calls).toEqual([["organization_id", mocks.org], ["lead_id", "lead-test"], ["external_source", "toth"]]);
    mocks.flag = false;
    hook.rerender();
    expect(hook.result.current.data).toBeUndefined();
  });
  it("não consulta outra organização mesmo que a flag esteja ligada", () => {
    mocks.org = "outra-organizacao";
    setup();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("não consulta lead oculto, sem ERP ou cartão fechado", () => {
    setup(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("expõe erro sem prender o cartão em carregamento", async () => {
    const builder = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error("offline") }) };
    mocks.from.mockReturnValue(builder);
    const hook = setup();
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(hook.result.current.isFetching).toBe(false);
  });
});
