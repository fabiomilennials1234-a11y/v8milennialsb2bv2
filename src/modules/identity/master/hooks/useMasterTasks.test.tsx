import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createMockSupabase } from "../../../../../tests/helpers/supabase-mock";
import { useMasterTaskOwners, useMasterTasks } from "./useMasterTasks";
import { selectTaskOwners } from "../lib/master-tasks";

const auth = vi.hoisted(() => ({ full: true, user: "user-1" }));
let mock: ReturnType<typeof createMockSupabase>;
vi.mock("./useMasterAuth", () => ({ useMasterAuth: () => ({ isFullMaster: auth.full, masterUser: { user_id: auth.user } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (name: string) => mock.sb.from(name), rpc: (name: string) => mock.sb.rpc(name),
} }));
const wrapper = (client: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
beforeEach(() => { mock = createMockSupabase(); auth.full = true; auth.user = "user-1"; });

it("filtra pelo master selecionado, pagina além de 500 e separa o cache entre responsáveis", async () => {
  mock.mockTable("master_tasks", [
    ...Array.from({ length: 501 }, (_, index) => ({ id: `g-${index}`, owner_master_user_id: "gabriel", updated_at: "2026-10-26", status: "a_fazer" })),
    { id: "m", owner_master_user_id: "marcelo", updated_at: "2026-10-26", status: "feito" },
  ]);
  const client = newClient();
  const view = renderHook(({ owner }) => useMasterTasks(owner), { initialProps: { owner: "gabriel" }, wrapper: wrapper(client) });
  await waitFor(() => expect(view.result.current.data).toHaveLength(501));
  view.rerender({ owner: "marcelo" });
  await waitFor(() => expect(view.result.current.data).toHaveLength(1));
  expect(view.result.current.data?.[0].id).toBe("m");
  expect(client.getQueryData(["master-tasks", "user-1", "gabriel"])).toHaveLength(501);
});

it("não consulta para perfil restrito ou sem responsável", () => {
  auth.full = false;
  const { result } = renderHook(() => useMasterTasks("gabriel"), { wrapper: wrapper(newClient()) });
  expect(result.current.fetchStatus).toBe("idle");
});

it("usa os IDs reais dos três masters confirmados, sem incluir outros nomes", () => {
  expect(selectTaskOwners([
    { id: "l", userId: "ul", name: "Lucas Silva" }, { id: "other", userId: "uo", name: "Leonardo" },
    { id: "m", userId: "um", name: "Marcelo Montemezzo" }, { id: "g", userId: "ug", name: "Gabriel Gipp" },
  ])).toEqual([
    { id: "g", userId: "ug", name: "Gabriel" }, { id: "m", userId: "um", name: "Marcelo" }, { id: "l", userId: "ul", name: "Lucas" },
  ]);
});

it("cruza os nomes com contas ativas de master pleno, excluindo perfis restritos", async () => {
  mock.mockRpc("master_list_staff", [
    { master_user_id: "g", name: "Gabriel Gipp" }, { master_user_id: "m", name: "Marcelo" }, { master_user_id: "l", name: "Lucas" },
  ]);
  mock.mockTable("master_users", [
    { id: "g", user_id: "ug", is_active: true, permissions: { all: true } },
    { id: "m", user_id: "um", is_active: false, permissions: { all: true } },
    { id: "l", user_id: "ul", is_active: true, permissions: { all: false, outbound_only: true } },
  ]);
  const { result } = renderHook(() => useMasterTaskOwners(), { wrapper: wrapper(newClient()) });
  await waitFor(() => expect(result.current.data).toEqual([{ id: "g", userId: "ug", name: "Gabriel" }]));
});
