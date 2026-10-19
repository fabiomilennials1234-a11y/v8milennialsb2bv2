import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contatos (Chamado 33c5fd52 · PR6). O banco decide a regra (RPCs + RLS); aqui
 * se prova o que o front controla: argumentos das RPCs, o erro original que
 * sobe, a leitura paginada e o que relê depois de cada escrita.
 * `supabase.rpc` é chamado NO objeto (a referência solta perde o receiver).
 */

const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => db.rpc(...args),
    from: (...args: unknown[]) => db.from(...args),
  },
}));

import {
  CONTACTS_KEY,
  useContacts,
  useCreateContact,
  useDeleteContact,
  useLeadPicker,
  useLinkLeadContact,
  useUnlinkLeadContact,
  useUpdateContact,
} from "./useContacts";

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  db.rpc = vi.fn().mockResolvedValue({ data: "c1", error: null });
  db.from = vi.fn();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("useContacts", () => {
  it("chama contact_list com org, busca e página", async () => {
    db.rpc.mockResolvedValue({
      data: { total: 1, rows: [{ id: "c1", name: "Maria", phones: [], leads: [] }] },
      error: null,
    });
    const { result } = renderHook(() => useContacts({ organizationId: "o1", search: " maria ", page: 1 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(db.rpc).toHaveBeenCalledWith("contact_list", {
      p_org: "o1",
      p_search: "maria",
      p_limit: 50,
      p_offset: 50,
    });
    expect(result.current.data?.rows[0].name).toBe("Maria");
  });

  it("sem org não consulta", () => {
    renderHook(() => useContacts({ organizationId: null, search: "", page: 0 }), { wrapper });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("erro do banco SOBE (lista vazia esconderia contatos em silêncio)", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    const { result } = renderHook(() => useContacts({ organizationId: "o1", search: "", page: 0 }), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("escrita", () => {
  it("criar: contato SEM lead e SEM empresa; telefones e leads vão no mesmo gesto", async () => {
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateContact("o1"), { wrapper });
    let id = "";
    await act(async () => {
      id = await result.current.mutateAsync({
        name: " Maria ",
        email: "maria@cafe.com",
        jobTitle: "",
        phones: [{ phone: "48999991111", label: "Celular", isPrimary: true }],
        leadIds: ["l1", "l2"],
      });
    });
    expect(id).toBe("c1");
    expect(db.rpc).toHaveBeenCalledWith("contact_create", {
      p_org: "o1",
      p_name: "Maria",
      p_email: "maria@cafe.com",
      p_job_title: undefined,
      p_phones: [{ phone: "48999991111", label: "Celular", is_primary: true }],
      p_lead_ids: ["l1", "l2"],
    });
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: [CONTACTS_KEY] }));
  });

  it("editar: manda o conjunto inteiro e devolve o id", async () => {
    const { result } = renderHook(() => useUpdateContact(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        id: "c1",
        values: { name: "Maria Silva", email: "", jobTitle: "Compras", phones: [], leadIds: [] },
      });
    });
    expect(db.rpc).toHaveBeenCalledWith("contact_update", {
      p_contact_id: "c1",
      p_name: "Maria Silva",
      p_email: undefined,
      p_job_title: "Compras",
      p_phones: [],
    });
  });

  it("excluir, vincular e desvincular chamam as RPCs certas", async () => {
    const del = renderHook(() => useDeleteContact(), { wrapper });
    await act(async () => { await del.result.current.mutateAsync("c1"); });
    expect(db.rpc).toHaveBeenLastCalledWith("contact_delete", { p_contact_id: "c1" });

    const link = renderHook(() => useLinkLeadContact(), { wrapper });
    await act(async () => { await link.result.current.mutateAsync({ contactId: "c1", leadId: "l1", papel: " comprador " }); });
    expect(db.rpc).toHaveBeenLastCalledWith("lead_contact_link", {
      p_lead_id: "l1",
      p_contact_id: "c1",
      p_papel: "comprador",
    });

    const unlink = renderHook(() => useUnlinkLeadContact(), { wrapper });
    await act(async () => { await unlink.result.current.mutateAsync({ contactId: "c1", leadId: "l1" }); });
    expect(db.rpc).toHaveBeenLastCalledWith("lead_contact_unlink", { p_lead_id: "l1", p_contact_id: "c1" });
  });

  it("o erro ORIGINAL do PostgREST sobe (com code)", async () => {
    const erro = { code: "PT404", message: "Contato não encontrado." };
    db.rpc.mockResolvedValue({ data: null, error: erro });
    const { result } = renderHook(() => useDeleteContact(), { wrapper });
    await expect(result.current.mutateAsync("c1")).rejects.toBe(erro);
  });
});

describe("useLeadPicker", () => {
  function cadeia(data: unknown[]) {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "ilike", "order"]) q[m] = vi.fn(() => q);
    q.limit = vi.fn().mockResolvedValue({ data, error: null });
    return q;
  }

  it("busca leads da org por nome, com teto de 20, escapando curingas", async () => {
    const q = cadeia([{ id: "l1", name: "Lead 100%" }]);
    db.from.mockReturnValue(q);
    const { result } = renderHook(() => useLeadPicker("o1", "100%"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(db.from).toHaveBeenCalledWith("leads");
    expect(q.eq).toHaveBeenCalledWith("organization_id", "o1");
    expect(q.is).toHaveBeenCalledWith("deleted_at", null);
    expect(q.ilike).toHaveBeenCalledWith("name", String.raw`%100\%%`);
    expect(q.limit).toHaveBeenCalledWith(20);
    expect(result.current.data).toEqual([{ id: "l1", name: "Lead 100%" }]);
  });

  it("busca curta demais não consulta", () => {
    renderHook(() => useLeadPicker("o1", "a"), { wrapper });
    expect(db.from).not.toHaveBeenCalled();
  });
});
