import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBoasVindasSemana } from "./useBoasVindasSemana";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  user: "user-a" as string | null,
  org: "org-a" as string | null,
  pronto: true,
  membro: { id: "tm-1" } as { id: string } | null,
  pode: { allowed: true, isLoading: false },
}));

vi.mock("@/modules/identity", () => ({
  useAuth: () => ({ user: mocks.user ? { id: mocks.user } : null }),
  useOrganization: () => ({ organizationId: mocks.org, isReady: mocks.pronto }),
  useCurrentTeamMember: () => ({ data: mocks.membro }),
  useCanDo: () => mocks.pode,
  isVirtualTeamMember: (id: string | null | undefined) => /^(master|gestor)-virtual-/.test(id ?? ""),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));

const entrega = {
  elegivel: true,
  inicio: "2027-10-25",
  fim: "2027-10-31",
  leads: 5,
  vendas: 3,
  receita: 1800,
  por_dia: {
    leads: [2, 0, 1, 1, 0, 0, 1],
    vendas: [0, 1, 0, 1, 0, 0, 1],
    receita: [0, 1000, 0, 500, 0, 0, 300],
  },
};

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useBoasVindasSemana(), { wrapper });
}

describe("useBoasVindasSemana", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: entrega, error: null });
    Object.assign(mocks, {
      user: "user-a",
      org: "org-a",
      pronto: true,
      membro: { id: "tm-1" },
      pode: { allowed: true, isLoading: false },
    });
  });
  afterEach(cleanup);

  it("com metrics.view, reivindica a semana da org ativa e devolve o resumo", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.data).not.toBeUndefined());
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("boas_vindas_semana_reivindicar", { p_org_id: "org-a" });
    expect(result.current.data?.leads).toBe(5);
    expect(result.current.data?.periodo).toBe("25 de out. a 31 de out.");
  });

  // Chamar CONSOME a semana: cada uma destas guardas protege um "já viu" que
  // ninguém viu.
  it.each([
    ["sem metrics.view", () => { mocks.pode = { allowed: false, isLoading: false }; }],
    ["permissão ainda carregando", () => { mocks.pode = { allowed: false, isLoading: true }; }],
    ["master (membro virtual)", () => { mocks.membro = { id: "master-virtual-u1" }; }],
    ["gestor de portfólio (membro virtual)", () => { mocks.membro = { id: "gestor-virtual-u1" }; }],
    ["sem membro na org", () => { mocks.membro = null; }],
    ["org ainda não resolvida", () => { mocks.pronto = false; }],
    ["sem organização", () => { mocks.org = null; }],
    ["sem login", () => { mocks.user = null; }],
  ])("NÃO reivindica: %s", async (_nome, preparar) => {
    preparar();
    const { result } = render();
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("já viu esta semana: sem animação", async () => {
    mocks.rpc.mockResolvedValue({ data: { elegivel: false, motivo: "ja_vista" }, error: null });
    const { result } = render();
    await waitFor(() => expect(result.current.data).toBeNull());
  });

  it("erro do banco não vira erro na tela: sem animação, e só", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { result } = render();
    await waitFor(() => expect(result.current.data).toBeNull());
    expect(result.current.isError).toBe(false);
    erro.mockRestore();
  });

  it("resposta fora do formato: sem animação", async () => {
    mocks.rpc.mockResolvedValue({ data: { elegivel: true, leads: "muitos" }, error: null });
    const { result } = render();
    await waitFor(() => expect(result.current.data).toBeNull());
  });
});
