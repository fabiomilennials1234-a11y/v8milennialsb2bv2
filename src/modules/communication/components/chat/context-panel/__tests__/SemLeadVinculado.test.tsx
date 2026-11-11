/**
 * Aba Infos sem lead: número em 2+ cadastros lista os cadastros e vincula a
 * conversa pela RPC `escolher_lead_do_numero`. O hook roda de verdade sobre um
 * Supabase falso com linhas reais (mesmo leitor do trigger/borda).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeTables } from "../../../../../../../tests/helpers/fake-supabase-tables";

const ORG = "org-cafe";
const PHONE = "554299990001";
const NORM = "42999990001";

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  rpc: vi.fn(),
  toastSuccess: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabaseTables: fake } = await import("../../../../../../../tests/helpers/fake-supabase-tables");
  return {
    supabase: {
      from: (t: string) => fake(h.tables as FakeTables).supabase.from(t),
      rpc: (...args: unknown[]) => h.rpc(...args),
    },
  };
});
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { organization_id: ORG } }),
}));
vi.mock("@/modules/communication/components/chat/LeadContactModal", () => ({ LeadContactModal: () => null }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: vi.fn() } }));
vi.mock("@/shared/errors", () => ({ notifyError: h.notifyError }));

import { SemLeadVinculado } from "../SemLeadVinculado";

const lead = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, organization_id: ORG, name, company: null, erp_code: null, normalized_phone: null, deleted_at: null, ...over,
});

function renderPainel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <SemLeadVinculado phoneNumber={PHONE} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe("SemLeadVinculado", () => {
  beforeEach(() => {
    h.rpc.mockReset();
    h.toastSuccess.mockReset();
    h.notifyError.mockReset();
    h.tables = {
      leads: [
        lead("L-PF", "Cliente Exemplo", { normalized_phone: NORM, erp_code: "90061" }),
        lead("L-PJ", "Cliente Exemplo ME", { company: "Exemplo Cafés", erp_code: "90510" }),
        lead("L-PJ2", "Exemplo Filial", { company: "Exemplo Cafés", erp_code: "90177" }),
      ],
      lead_phones: [
        { organization_id: ORG, lead_id: "L-PJ", normalized_phone: NORM, deleted_at: null },
        { organization_id: ORG, lead_id: "L-PJ2", normalized_phone: NORM, deleted_at: null },
      ],
      deals: [],
      whatsapp_numero_lead_escolhido: [],
      whatsapp_messages: [],
    };
  });

  it("número em 3 cadastros: lista nome, empresa e código do ERP, e mantém Criar ou vincular", async () => {
    renderPainel();
    expect(await screen.findByText("Este número está em 3 cadastros")).toBeInTheDocument();
    const itens = screen.getAllByRole("listitem");
    expect(itens.map((li) => within(li).getByText(/Exemplo/, { selector: "span[title]" }).textContent)).toEqual([
      "Cliente Exemplo",
      "Cliente Exemplo ME",
      "Exemplo Filial",
    ]);
    expect(within(itens[1]).getByText("Exemplo Cafés")).toBeInTheDocument();
    expect(within(itens[1]).getByText("ERP 90510")).toBeInTheDocument();
    expect(screen.queryByText("Nenhum lead vinculado a")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Criar ou vincular lead/ })).toBeInTheDocument();
  });

  it("Vincular esta conversa chama a RPC com org, número e lead; sucesso invalida lead e chat", async () => {
    h.rpc.mockResolvedValue({ data: 144, error: null });
    const { invalidate } = renderPainel();
    fireEvent.click(await screen.findByRole("button", { name: "Vincular esta conversa a Cliente Exemplo ME" }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.rpc).toHaveBeenCalledWith("escolher_lead_do_numero", {
      p_organization_id: ORG,
      p_phone: PHONE,
      p_lead_id: "L-PJ",
    });
    expect(h.toastSuccess.mock.calls[0][0]).toBe("Conversa vinculada a Cliente Exemplo ME");
    expect(h.toastSuccess.mock.calls[0][1].description).toMatch(/^144 mensagens vinculadas/);
    const chaves = invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey[0]);
    expect(chaves).toEqual(
      expect.arrayContaining(["lead_by_phone", "numero_cadastros", "whatsapp_contacts", "whatsapp_messages"]),
    );
  });

  it("recusa da RPC vai ao notifyError com a frase em PT, sem toast de sucesso", async () => {
    const recusa = {
      code: "P0001",
      message: "Este cadastro não tem mais este número.",
      details: "lead_nao_e_cadastro_do_numero",
      hint: "Atualize a conversa e tente de novo.",
    };
    h.rpc.mockResolvedValue({ data: null, error: recusa });
    renderPainel();
    fireEvent.click(await screen.findByRole("button", { name: "Vincular esta conversa a Exemplo Filial" }));
    await waitFor(() => expect(h.notifyError).toHaveBeenCalled());
    // O erro da RPC chega inteiro ao notifyError (toAppError mostra a frase em PT).
    expect(h.notifyError.mock.calls[0][0]).toMatchObject({ message: recusa.message });
    expect(h.notifyError.mock.calls[0][1].fallback).toBe("Não foi possível vincular a conversa.");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("a frase de recusa da RPC é a que o toAppError mostra ao usuário", async () => {
    const { toAppError } = await vi.importActual<typeof import("@/shared/errors/to-app-error")>(
      "@/shared/errors/to-app-error",
    );
    const recusa = {
      code: "P0001",
      message: "Este cadastro não tem mais este número.",
      details: "lead_nao_e_cadastro_do_numero",
      hint: "Atualize a conversa e tente de novo.",
    };
    expect(toAppError(recusa, "x").userMessage).toBe(
      "Este cadastro não tem mais este número. Atualize a conversa e tente de novo.",
    );
  });

  it("número de um cadastro só (ou nenhum): diagnóstico de sempre, sem lista", async () => {
    h.tables.lead_phones = [];
    h.tables.leads = [lead("L-OUTRO", "Outro", { normalized_phone: "48911110000" })];
    renderPainel();
    expect(await screen.findByText("Nenhum lead vinculado a")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
