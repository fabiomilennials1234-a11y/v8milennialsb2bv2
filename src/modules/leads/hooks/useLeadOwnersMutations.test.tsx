import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

/**
 * Escrita de donos (Chamado 793f4b05 · PR3). O banco é a fonte da regra (RPCs +
 * RLS); aqui se prova o que o front controla: argumentos, o erro original que
 * sobe para `notifyError`, o texto da recusa e o que relê depois de uma troca.
 */

const db = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => db.rpc(...args) },
}));
vi.mock("./useLeads", () => ({ LEAD_RESPONSIBLE_MAP_KEY: "lead-responsible-map" }));
vi.mock("./useLeadOwners", () => ({ leadOwnersKey: (id: string | null) => ["lead-owners", id] }));

import {
  recusaDeDonos,
  useAddLeadOwner,
  useRemoveLeadOwner,
  useTransferLeadOwner,
} from "./useLeadOwnersMutations";

let qc: QueryClient;
let invalidate: MockInstance<QueryClient["invalidateQueries"]>;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  db.rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidate = vi.spyOn(qc, "invalidateQueries");
});

function invalidou(chave: string) {
  return invalidate.mock.calls.some(
    ([filtro]) => (filtro as { queryKey?: unknown[] })?.queryKey?.[0] === chave,
  );
}

describe("recusaDeDonos", () => {
  it.each([
    ["PT403", "Esta organização não usa mais de um dono por lead."],
    ["PT404", "Lead não encontrado. Atualize a ficha."],
    ["PT409", "Para tirar o dono principal, passe o lead para outra pessoa."],
    ["PT422", "Essa pessoa não pode ser dona deste lead."],
  ])("%s vira texto pt-BR", (code, texto) => {
    expect(recusaDeDonos({ code, message: "raw" })).toBe(texto);
  });

  it("42501 usa a frase do banco quando ela é pt-BR (diz se faltou sessão ou permissão)", () => {
    expect(
      recusaDeDonos({ code: "42501", message: "Você não pode alterar os responsáveis deste lead." }),
    ).toBe("Você não pode alterar os responsáveis deste lead.");
  });

  it("42501 do Postgres em inglês não vai para a tela", () => {
    expect(recusaDeDonos({ code: "42501", message: "permission denied for table lead_owners" })).toBeUndefined();
  });

  it("erro desconhecido ou sem código devolve undefined — a tela cai no fallback", () => {
    expect(recusaDeDonos({ code: "XX000", message: "relation boom" })).toBeUndefined();
    expect(recusaDeDonos({ message: "Failed to fetch" })).toBeUndefined();
    expect(recusaDeDonos(null)).toBeUndefined();
  });
});

describe("mutações de donos", () => {
  it("add chama lead_owner_add com lead e membro, e relê ficha, lista, funil e inbox", async () => {
    const { result } = renderHook(() => useAddLeadOwner("lead-1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("tm-9");
    });
    expect(db.rpc).toHaveBeenCalledWith("lead_owner_add", { p_lead_id: "lead-1", p_team_member_id: "tm-9" });
    for (const chave of [
      "lead-owners",
      "lead-detail",
      "lead-responsibles",
      "lead-responsible-map",
      "leads",
      "pipeline_entries",
      "pipeline-page",
    ]) {
      expect(invalidou(chave), chave).toBe(true);
    }
  });

  it("remove chama lead_owner_remove", async () => {
    const { result } = renderHook(() => useRemoveLeadOwner("lead-1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("tm-9");
    });
    expect(db.rpc).toHaveBeenCalledWith("lead_owner_remove", { p_lead_id: "lead-1", p_team_member_id: "tm-9" });
  });

  it("transfer manda papel e se mantém o anterior", async () => {
    const { result } = renderHook(() => useTransferLeadOwner("lead-1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ toMemberId: "tm-2", role: "venda", keepPrevious: false });
    });
    expect(db.rpc).toHaveBeenCalledWith("lead_owner_transfer", {
      p_lead_id: "lead-1",
      p_to_member: "tm-2",
      p_role: "venda",
      p_keep_previous: false,
    });
  });

  it("recusa do banco chega à tela com o código original e ainda relê (o dado pode ter mudado)", async () => {
    db.rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "PT409", message: "raw" } });
    const { result } = renderHook(() => useRemoveLeadOwner("lead-1"), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync("tm-1")).rejects.toMatchObject({ code: "PT409" });
    });
    expect(invalidou("lead-owners")).toBe(true);
  });
});
