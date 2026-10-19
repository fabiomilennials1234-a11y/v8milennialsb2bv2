/**
 * `useLeadByPhone` resolve o lead de uma conversa pelo número.
 *
 * Chamados 2c4e502c / b9ccde65 (Café Jurerê): o lead guarda UM telefone em
 * `leads.phone`; os demais contatos moram em `lead_phones`. A busca só olhava
 * `leads.normalized_phone`, então abrir a conversa pelo SEGUNDO contato do lead
 * caía em "Criar ou vincular lead" como se o número fosse desconhecido.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

type Call = { table: string; filters: Array<[string, string, unknown]> };
const calls: Call[] = [];
const respostas: Record<string, (c: Call) => unknown> = {};

function chain(table: string) {
  const call: Call = { table, filters: [] };
  calls.push(call);
  const c: Record<string, any> = {};
  for (const m of ["select", "order", "limit"]) c[m] = vi.fn().mockReturnValue(c);
  for (const m of ["eq", "is"]) {
    c[m] = vi.fn((col: string, val: unknown) => {
      call.filters.push([m, col, val]);
      return c;
    });
  }
  c.maybeSingle = vi.fn(async () => ({ data: respostas[table]?.(call) ?? null, error: null }));
  return c;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => chain(t) },
}));
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-t", role: "admin" } }),
  isVirtualTeamMember: () => false,
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }),
}));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true, teamMemberId: "tm1" }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));
vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: false }) }));
vi.mock("@/modules/identity/permissions/lib/permissions", () => ({
  assertIsAdmin: vi.fn(),
  useCanPerformActionAsync: () => ({ data: { allowed: true } }),
}));
vi.mock("@/lib/normalizePhone", () => ({
  normalizePhone: (p: string) => (p ? p.replace(/\D/g, "") : null),
}));

import { useLeadByPhone } from "@/modules/communication/hooks/useWhatsAppLeadIntegration";

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(respostas)) delete respostas[k];
});

describe("useLeadByPhone — contatos do lead", () => {
  it("acha o lead pelo SEGUNDO contato (só existe em lead_phones)", async () => {
    respostas.leads = (c) =>
      c.filters.some(([, col, v]) => col === "id" && v === "lead-1") ? { id: "lead-1", name: "Cliente" } : null;
    respostas.lead_phones = () => ({ lead_id: "lead-1" });

    const { result } = renderHook(() => useLeadByPhone("(19) 3852-1276"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.data).toEqual({ id: "lead-1", name: "Cliente" }));
    const fone = calls.find((c) => c.table === "lead_phones")!;
    expect(fone.filters).toContainEqual(["eq", "organization_id", "org-t"]);
    expect(fone.filters).toContainEqual(["eq", "normalized_phone", "1938521276"]);
    expect(fone.filters).toContainEqual(["is", "deleted_at", null]);
  });

  it("não consulta lead_phones quando o número é o principal de um lead", async () => {
    respostas.leads = () => ({ id: "lead-9", name: "Principal" });

    const { result } = renderHook(() => useLeadByPhone("19991244569"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.data).toEqual({ id: "lead-9", name: "Principal" }));
    expect(calls.some((c) => c.table === "lead_phones")).toBe(false);
  });

  it("ignora lead apagado: a busca por telefone filtra deleted_at", async () => {
    respostas.leads = () => null;
    const { result } = renderHook(() => useLeadByPhone("19991244569"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isFetched).toBe(true));
    const porFone = calls.find((c) => c.table === "leads")!;
    expect(porFone.filters).toContainEqual(["is", "deleted_at", null]);
  });

  it("número desconhecido continua devolvendo null", async () => {
    const { result } = renderHook(() => useLeadByPhone("11999990000"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
