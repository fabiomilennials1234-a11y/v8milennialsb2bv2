/**
 * Chamado 99067f13 — "não consigo colocar alguns telefones como principal
 * (mesmo sendo o único do cadastro)". `idx_leads_org_phone_unique` deixa um
 * número ser o principal de UM só lead vivo da org; o cadastro duplicado do ERP
 * (cliente 3759 × 4545) já segura o número. A tela dizia só "já é o principal de
 * outro lead", sem dizer qual — e o vendedor, que procurava por Leads e não
 * achava nenhum outro, concluía que era defeito.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";
import { mensagemDePrincipalOcupado } from "@/modules/leads/lib/lead-phones";

const rpc = vi.fn();
const donoQuery = vi.fn();
const filtros: Array<[string, string, unknown]> = [];

function chain() {
  const c: Record<string, any> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockReturnValue(c);
  for (const m of ["eq", "neq", "is"]) {
    c[m] = vi.fn((col: string, val: unknown) => {
      filtros.push([m, col, val]);
      return c;
    });
  }
  c.maybeSingle = vi.fn(async () => donoQuery());
  return c;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => chain() },
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

import { useSalvarTelefonesDoLead } from "@/modules/leads/hooks/useLeadPhones";

beforeEach(() => {
  rpc.mockReset();
  donoQuery.mockReset();
  filtros.length = 0;
});

describe("mensagemDePrincipalOcupado", () => {
  it("diz QUAL lead segura o número (código do ERP + nome)", () => {
    expect(mensagemDePrincipalOcupado({ name: "REFEICOES AO PONTO LTDA", erp_code: "4545" })).toBe(
      "Este número já é o principal do lead 4545 - REFEICOES AO PONTO LTDA. Tire-o de lá ou escolha outro número.",
    );
  });

  it("sem código do ERP, usa só o nome", () => {
    expect(mensagemDePrincipalOcupado({ name: "Padaria Um", erp_code: null })).toContain("lead Padaria Um.");
  });

  it("dono invisível para o usuário (RLS): mantém a frase genérica, sem vazar nada", () => {
    expect(mensagemDePrincipalOcupado(null)).toBe("Este número já é o principal de outro lead da organização");
  });
});

describe("useSalvarTelefonesDoLead — número que é principal de outro lead", () => {
  const telefones = [{ id: "p1", phone: "(51) 98203-0889", label: "LISI", isPrimary: true }];

  it("23505 vira a frase com o lead que segura o número", async () => {
    rpc.mockResolvedValue({ error: { code: "23505", message: 'duplicate key value violates unique constraint "idx_leads_org_phone_unique"' } });
    donoQuery.mockResolvedValue({ data: { id: "lead-4545", name: "TRENTIN LTDA", erp_code: "4545" }, error: null });

    const { result } = renderHook(() => useSalvarTelefonesDoLead("lead-3759"), { wrapper: createWrapper() });
    await act(async () => {
      await expect(result.current.mutateAsync(telefones)).rejects.toThrow(
        "Este número já é o principal do lead 4545 - TRENTIN LTDA. Tire-o de lá ou escolha outro número.",
      );
    });

    expect(filtros).toContainEqual(["eq", "organization_id", "org-t"]);
    expect(filtros).toContainEqual(["eq", "normalized_phone", "51982030889"]);
    expect(filtros).toContainEqual(["is", "deleted_at", null]);
    expect(filtros).toContainEqual(["neq", "id", "lead-3759"]);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("não acha o dono (RLS): frase genérica", async () => {
    rpc.mockResolvedValue({ error: { code: "23505", message: 'duplicate key value violates unique constraint "idx_leads_org_phone_unique"' } });
    donoQuery.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useSalvarTelefonesDoLead("lead-3759"), { wrapper: createWrapper() });
    await act(async () => {
      await expect(result.current.mutateAsync(telefones)).rejects.toThrow(
        "Este número já é o principal de outro lead da organização",
      );
    });
  });
});
