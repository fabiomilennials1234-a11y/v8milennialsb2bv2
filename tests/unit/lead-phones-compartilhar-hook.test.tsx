/**
 * Chamado 99067f13, PR4 — contrato dos hooks com a RPC:
 * `p_permitir_compartilhado` só viaja quando o usuário confirmou; o 23505 vira
 * `PrincipalOcupadoError` (com ou sem o dono, conforme o RLS); desfazer chama
 * `lead_phone_descompartilhar`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";
import { PrincipalOcupadoError } from "@/modules/leads/lib/lead-phones";

const rpc = vi.fn();
const donoQuery = vi.fn();
const filtros: Array<[string, string, unknown]> = [];

function chain() {
  const c: Record<string, unknown> = {};
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
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true, teamMemberId: "tm1" }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-t", role: "admin" } }),
  isVirtualTeamMember: () => false,
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }),
}));

import { useSalvarTelefonesDoLead } from "@/modules/leads/hooks/useLeadPhones";
import { useDescompartilharNumero } from "@/modules/leads/hooks/useLeadPhoneCompartilhado";

const telefones = [{ id: "p1", phone: "(51) 98203-0889", label: "LISI", isPrimary: true }];
// Mensagem literal do Postgres para o UPDATE de leads.phone (conferida no pgTAP CF1b).
const INDICE_DO_PRINCIPAL = 'duplicate key value violates unique constraint "idx_leads_org_phone_unique"';

beforeEach(() => {
  rpc.mockReset();
  donoQuery.mockReset();
  filtros.length = 0;
});

describe("useSalvarTelefonesDoLead — compartilhar", () => {
  it("sem confirmação a RPC NÃO leva p_permitir_compartilhado", async () => {
    rpc.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useSalvarTelefonesDoLead("lead-3759"), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync(telefones);
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("salvar_telefones_do_lead");
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_permitir_compartilhado");
  });

  it("23505 vira PrincipalOcupadoError com o dono (e só o NÃO compartilhado)", async () => {
    rpc.mockResolvedValue({ error: { code: "23505", message: INDICE_DO_PRINCIPAL } });
    donoQuery.mockResolvedValue({ data: { id: "lead-4545", name: "TRENTIN LTDA", erp_code: "4545" }, error: null });
    const { result } = renderHook(() => useSalvarTelefonesDoLead("lead-3759"), { wrapper: createWrapper() });
    let erro: unknown;
    await act(async () => {
      await result.current.mutateAsync(telefones).catch((e) => (erro = e));
    });
    expect(erro).toBeInstanceOf(PrincipalOcupadoError);
    expect((erro as PrincipalOcupadoError).dono).toEqual({ id: "lead-4545", name: "TRENTIN LTDA", erp_code: "4545" });
    expect(filtros).toContainEqual(["eq", "phone_compartilhado", false]);
  });

  it("dono invisível (RLS): PrincipalOcupadoError com dono null", async () => {
    rpc.mockResolvedValue({ error: { code: "23505", message: INDICE_DO_PRINCIPAL } });
    donoQuery.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useSalvarTelefonesDoLead("lead-3759"), { wrapper: createWrapper() });
    let erro: unknown;
    await act(async () => {
      await result.current.mutateAsync(telefones).catch((e) => (erro = e));
    });
    expect(erro).toBeInstanceOf(PrincipalOcupadoError);
    expect((erro as PrincipalOcupadoError).dono).toBeNull();
  });

  it("phone_duplicated também é 23505, mas NÃO é principal ocupado", async () => {
    rpc.mockResolvedValue({ error: { code: "23505", message: "phone_duplicated" } });
    const { result } = renderHook(() => useSalvarTelefonesDoLead("lead-3759"), { wrapper: createWrapper() });
    let erro: unknown;
    await act(async () => {
      await result.current.mutateAsync(telefones).catch((e) => (erro = e));
    });
    expect(erro).not.toBeInstanceOf(PrincipalOcupadoError);
    expect((erro as Error).message).toBe("O mesmo telefone aparece duas vezes");
  });

  it("23505 de OUTRO índice não oferece compartilhar", async () => {
    rpc.mockResolvedValue({
      error: { code: "23505", message: 'duplicate key value violates unique constraint "lead_phones_pkey"' },
    });
    const { result } = renderHook(() => useSalvarTelefonesDoLead("lead-3759"), { wrapper: createWrapper() });
    let erro: unknown;
    await act(async () => {
      await result.current.mutateAsync(telefones).catch((e) => (erro = e));
    });
    expect(erro).not.toBeInstanceOf(PrincipalOcupadoError);
    expect(filtros).toHaveLength(0);
  });

  it("confirmado: a RPC leva p_permitir_compartilhado: true e não há busca de dono", async () => {
    rpc.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useSalvarTelefonesDoLead("lead-3759"), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ telefones, permitirCompartilhado: true });
    });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_lead_id: "lead-3759", p_permitir_compartilhado: true });
    expect(filtros).toHaveLength(0);
  });

  it("confirmado e o banco recusa sem permissão: sobe a frase, nunca outro diálogo", async () => {
    rpc.mockResolvedValue({ error: { code: "42501", message: "sem_permissao_lead" } });
    const { result } = renderHook(() => useSalvarTelefonesDoLead("lead-3759"), { wrapper: createWrapper() });
    let erro: unknown;
    await act(async () => {
      await result.current.mutateAsync({ telefones, permitirCompartilhado: true }).catch((e) => (erro = e));
    });
    expect(erro).not.toBeInstanceOf(PrincipalOcupadoError);
    expect((erro as Error).message).toBe("Você não pode editar este lead.");
  });
});

describe("useDescompartilharNumero", () => {
  it("chama lead_phone_descompartilhar com o lead", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const { result } = renderHook(() => useDescompartilharNumero("lead-3759"), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ telefonePrincipal: "(51) 98203-0889" });
    });
    expect(rpc).toHaveBeenCalledWith("lead_phone_descompartilhar", { p_lead_id: "lead-3759" });
  });

  it("recusa por conflito diz quem segura o número", async () => {
    rpc.mockResolvedValue({ error: { code: "23505", message: "principal_ocupado" } });
    donoQuery.mockResolvedValue({ data: { id: "lead-4545", name: "TRENTIN LTDA", erp_code: "4545" }, error: null });
    const { result } = renderHook(() => useDescompartilharNumero("lead-3759"), { wrapper: createWrapper() });
    let erro: unknown;
    await act(async () => {
      await result.current.mutateAsync({ telefonePrincipal: "(51) 98203-0889" }).catch((e) => (erro = e));
    });
    expect((erro as Error).message).toContain("o lead 4545 - TRENTIN LTDA já é o principal deste número");
  });

  it("recusa por conflito com dono invisível: frase genérica", async () => {
    rpc.mockResolvedValue({ error: { code: "23505", message: "principal_ocupado" } });
    donoQuery.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useDescompartilharNumero("lead-3759"), { wrapper: createWrapper() });
    let erro: unknown;
    await act(async () => {
      await result.current.mutateAsync({ telefonePrincipal: "(51) 98203-0889" }).catch((e) => (erro = e));
    });
    expect((erro as Error).message).toContain("outro lead da organização já é o principal deste número");
  });

  it("sem permissão: a frase de permissão", async () => {
    rpc.mockResolvedValue({ error: { code: "42501", message: "sem_permissao_lead" } });
    const { result } = renderHook(() => useDescompartilharNumero("lead-3759"), { wrapper: createWrapper() });
    let erro: unknown;
    await act(async () => {
      await result.current.mutateAsync({ telefonePrincipal: null }).catch((e) => (erro = e));
    });
    expect((erro as Error).message).toBe("Você não pode editar este lead.");
  });
});
