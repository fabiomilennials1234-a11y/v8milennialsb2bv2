import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLossReasons, useRenameLossReason } from "./useLossReasons";

const RIOFIX = "36971ff5-fd73-4f30-a733-04bf8c90e5b6";
const mock = vi.hoisted(() => ({
  organizationId: "36971ff5-fd73-4f30-a733-04bf8c90e5b6" as string | null,
  isAdmin: true,
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), update: vi.fn(), single: vi.fn(),
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: mock.organizationId }),
  useIdentity: () => ({ isAdmin: mock.isAdmin }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.organizationId = RIOFIX;
  mock.isAdmin = true;
  const chain = { select: mock.select, eq: mock.eq, order: mock.order, update: mock.update, single: mock.single };
  mock.from.mockReturnValue(chain);
  mock.select.mockReturnValue(chain);
  mock.eq.mockReturnValue(chain);
  mock.update.mockReturnValue(chain);
  mock.order.mockResolvedValue({ data: [{ id: "reason-1", name: "Preco", organization_id: RIOFIX }], error: null });
  mock.single.mockResolvedValue({ data: { id: "reason-1", name: "Preço", organization_id: RIOFIX }, error: null });
});

describe("catálogo de motivos de perda", () => {
  it("filtra explicitamente a org selecionada, mesmo quando o usuário master enxerga outras orgs", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(useLossReasons, { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mock.eq).toHaveBeenCalledWith("organization_id", RIOFIX);
    expect(mock.order).toHaveBeenCalledWith("display_order");
  });

  it("não consulta sem organização", () => {
    mock.organizationId = null;
    renderHook(useLossReasons, { wrapper: setup().wrapper });
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("trocar de organização não reaproveita motivos da anterior", async () => {
    const { wrapper } = setup();
    const { result, rerender } = renderHook(useLossReasons, { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    mock.organizationId = "outra-org";
    mock.order.mockResolvedValue({ data: [], error: null });
    rerender();
    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(mock.eq).toHaveBeenCalledWith("organization_id", "outra-org");
  });
});

describe("renomear motivo de perda", () => {
  it("atualiza só o nome na linha da org e invalida apenas seu catálogo", async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(useRenameLossReason, { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: "reason-1", name: "  Preço  " }); });
    expect(mock.from).toHaveBeenCalledWith("loss_reasons");
    expect(mock.update).toHaveBeenCalledWith({ name: "Preço" });
    expect(mock.eq).toHaveBeenCalledWith("organization_id", RIOFIX);
    expect(mock.eq).toHaveBeenCalledWith("id", "reason-1");
    expect(mock.single).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["loss_reasons", RIOFIX] });
  });

  it.each([
    ["outra organização", "outra-org", true],
    ["sem organização", null, true],
    ["membro sem administração", RIOFIX, false],
  ])("bloqueia %s antes de acessar a rede", async (_label, org, admin) => {
    mock.organizationId = org as string | null;
    mock.isAdmin = admin as boolean;
    const { result } = renderHook(useRenameLossReason, { wrapper: setup().wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ id: "reason-1", name: "Preço" })).rejects.toThrow("Edição indisponível");
    });
    expect(mock.from).not.toHaveBeenCalled();
  });

  it.each(["   ", "x".repeat(121)])("rejeita nome inválido sem enviar UPDATE", async (name) => {
    const { result } = renderHook(useRenameLossReason, { wrapper: setup().wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ id: "reason-1", name })).rejects.toThrow("Informe um nome");
    });
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("linha ausente ou bloqueada por RLS falha sem invalidar o catálogo", async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const error = { code: "PGRST116", message: "Cannot coerce the result to a single JSON object" };
    mock.single.mockResolvedValue({ data: null, error });
    const { result } = renderHook(useRenameLossReason, { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ id: "outro-id", name: "Preço" })).rejects.toEqual(error);
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
