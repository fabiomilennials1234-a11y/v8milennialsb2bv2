import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";
import type { ReactNode } from "react";

const auth = vi.hoisted(() => ({ isMaster: true }));
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ ...auth, isLoading: false }) }));
vi.mock("@/modules/identity/gestor/hooks/useGestor", () => ({ useGestor: () => ({ isGestor: false, isLoading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (...args: Parameters<typeof client.from>) => client.from(...args),
  rpc: (...args: Parameters<typeof client.rpc>) => client.rpc(...args),
} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useOrgSwitcher } from "./useOrgSwitcher";
import { getSelectedOrgId, setSelectedOrgId, useCurrentTeamMember } from "./useCurrentTeamMember";
import { useMasterSetOrgSuspension } from "../../master/hooks/useMasterOrganizations";

const org = (id: string, status: string, billing_override = false) => ({
  id, name: id, slug: id, org_type: "crm", subscription_status: status, billing_override,
});
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let client: ReturnType<typeof createClient>;
let queryClient: QueryClient;
let failOrganizations = false;

// Exercise the real PostgREST builder, including its not.in filter and single handling.
async function fetchRows(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input));
  if (url.pathname.includes("/rpc/")) {
    const args = JSON.parse(String(init?.body));
    const row = tables.organizations.find((o) => o.id === args._org_id)!;
    row.subscription_status = args._suspend ? "suspended" : "active";
    if (args._suspend) row.billing_override = false;
    return new Response(JSON.stringify({ org_id: row.id, status: row.subscription_status, billing_override: row.billing_override }), { status: 200 });
  }
  const table = url.pathname.split("/").at(-1)!;
  if (table === "organizations" && failOrganizations) return new Response(JSON.stringify({ message: "offline" }), { status: 503 });
  let rows = [...(tables[table] ?? [])];
  for (const [key, value] of url.searchParams) {
    if (value.startsWith("eq.")) rows = rows.filter((row) => String(row[key]) === value.slice(3));
    if (value.startsWith("not.in.(")) {
      const excluded = value.slice(8, -1).split(",");
      rows = rows.filter((row) => !excluded.includes(String(row[key])));
    }
  }
  if (url.searchParams.has("order")) rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (url.searchParams.has("limit")) rows = rows.slice(0, Number(url.searchParams.get("limit")));
  return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });
}

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  auth.isMaster = true;
  failOrganizations = false;
  localStorage.clear();
  tables = { organizations: [org("Ativa", "active"), org("Trial", "trial"), org("Suspensa", "suspended", true), org("Cancelada", "cancelled"), org("Expirada", "expired")], team_members: [] };
  client = createClient("https://test.invalid", "test-anon-key", { auth: { persistSession: false, autoRefreshToken: false, storageKey: crypto.randomUUID() }, global: { fetch: fetchRows } });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); queryClient.clear(); });

describe("seleção de organizações do master", () => {
  it("exclui status inativos mesmo com plano liberado e preserva ativa/trial", async () => {
    const { result } = renderHook(useOrgSwitcher, { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.orgs.map((o) => o.id)).toEqual(["Ativa", "Trial"]);
    await act(() => result.current.switchOrg("Suspensa"));
    expect(getSelectedOrgId()).toBeNull();
    await act(() => result.current.switchOrg("Trial"));
    expect(getSelectedOrgId()).toBe("Trial");
  });

  it("não restaura uma org inativa salva nem por vínculo real", async () => {
    setSelectedOrgId("Suspensa");
    tables.team_members = [{ id: "real", organization_id: "Suspensa", user_id: "user-1", is_active: true }];
    const { result } = renderHook(useCurrentTeamMember, { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.organization_id).toBe("Ativa");
    expect(getSelectedOrgId()).toBe("Ativa");
  });

  it("preserva a seleção válida e seu vínculo real", async () => {
    setSelectedOrgId("Trial");
    tables.team_members = [{ id: "real", organization_id: "Trial", user_id: "user-1", is_active: true }];
    const { result } = renderHook(useCurrentTeamMember, { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("real");
    expect(getSelectedOrgId()).toBe("Trial");
  });

  it("limpa a seleção quando nenhuma org está disponível", async () => {
    setSelectedOrgId("Suspensa");
    tables.organizations = [org("Suspensa", "suspended")];
    const { result } = renderHook(useCurrentTeamMember, { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(getSelectedOrgId()).toBeNull();
  });

  it("não trata falha de consulta como autorização para restaurar a org", async () => {
    setSelectedOrgId("Suspensa");
    failOrganizations = true;
    const { result } = renderHook(useOrgSwitcher, { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.orgs).toEqual([]);
  });

  it("mantém o fluxo de vínculo do usuário comum", async () => {
    auth.isMaster = false;
    tables.team_members = [{ id: "real", organization_id: "Ativa", user_id: "user-1", is_active: true }];
    const { result } = renderHook(useCurrentTeamMember, { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("real");
  });

  it("inativação e reativação atualizam o seletor e o contexto já montados", async () => {
    setSelectedOrgId("Ativa");
    const { result } = renderHook(() => ({ selector: useOrgSwitcher(), current: useCurrentTeamMember(), mutation: useMasterSetOrgSuspension() }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.current.data?.organization_id).toBe("Ativa"));
    await act(() => result.current.mutation.mutateAsync({ orgId: "Ativa", suspend: true, reason: "Solicitado" }));
    await waitFor(() => expect(result.current.selector.orgs.map((o) => o.id)).toEqual(["Trial"]));
    await waitFor(() => expect(result.current.current.data?.organization_id).toBe("Trial"));
    await act(() => result.current.mutation.mutateAsync({ orgId: "Ativa", suspend: false }));
    await waitFor(() => expect(result.current.selector.orgs.map((o) => o.id)).toEqual(["Ativa", "Trial"]));
  });
});
