/**
 * O painel de checklists dentro do Card do Negócio.
 *
 * ── O ESCOPO, QUE É A PARTE FÁCIL DE ERRAR ────────────────────────────────
 * `checklists` tem `lead_id` e não tem `deal_id`. O painel mostra os checklists
 * da PESSOA — a mesma regra que os comentários já seguem no card, pelo mesmo
 * motivo. Negócio sem lead não inventa lista: diz que não tem de quem.
 *
 * O resto do que se cobre aqui é o que o vendedor faz na tela: marcar item e
 * aplicar um dos checklists que a operação já tem cadastrados (os templates —
 * "os checklists que temos no sistema").
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const toggleMutate = vi.fn();
const applyMutate = vi.fn();

const checklistsDoLead = vi.fn(() => ({
  data: [{ id: "cl-1", title: "Qualificação", total_items: 2, completed_items: 1 }],
  isLoading: false,
}));

vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({
  useRealtimeSubscription: () => undefined,
}));

vi.mock("@/modules/engagement", () => ({
  useLeadChecklists: (...args: unknown[]) => checklistsDoLead(...(args as [])),
  useChecklistItems: () => ({
    data: [
      { id: "it-1", checklist_id: "cl-1", title: "Confirmar telefone", is_completed: false },
      { id: "it-2", checklist_id: "cl-1", title: "Validar empresa", is_completed: true },
    ],
  }),
  useToggleChecklistItem: () => ({ mutate: toggleMutate }),
  useCreateChecklist: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteChecklist: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useCreateChecklistItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteChecklistItem: () => ({ mutate: vi.fn() }),
  useChecklistTemplates: () => ({
    data: [{ id: "tpl-1", title: "Onboarding do cliente", total_items: 4 }],
  }),
  useApplyChecklistTemplate: () => ({ mutate: applyMutate, isPending: false }),
}));

import { DealCardChecklists } from "@/modules/leads/components/deal-card/DealCardChecklists";

beforeEach(() => {
  toggleMutate.mockClear();
  applyMutate.mockClear();
  checklistsDoLead.mockImplementation(() => ({
    data: [{ id: "cl-1", title: "Qualificação", total_items: 2, completed_items: 1 }],
    isLoading: false,
  }));
});

describe("DealCardChecklists", () => {
  it("lista os checklists do lead com os itens marcáveis", () => {
    render(<DealCardChecklists leadId="lead-1" />);
    expect(checklistsDoLead).toHaveBeenCalledWith("lead-1");
    expect(screen.getByText("Qualificação")).toBeInTheDocument();
    expect(screen.getByText("Confirmar telefone")).toBeInTheDocument();
  });

  it("marcar um item vai para a mutation com o checklist a que ele pertence", () => {
    render(<DealCardChecklists leadId="lead-1" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Confirmar telefone" }));
    expect(toggleMutate).toHaveBeenCalledWith({
      id: "it-1",
      checklist_id: "cl-1",
      is_completed: true,
    });
  });

  it("aplica um dos checklists da operação ao lead", () => {
    render(<DealCardChecklists leadId="lead-1" />);
    fireEvent.click(screen.getByText("Aplicar checklist"));
    fireEvent.click(screen.getByText("Onboarding do cliente"));
    expect(applyMutate).toHaveBeenCalledWith(
      { templateId: "tpl-1", leadId: "lead-1" },
      expect.anything(),
    );
  });

  it("sem checklist nenhum, o vazio explica as duas saídas em vez de só acusar falta", () => {
    checklistsDoLead.mockImplementation(() => ({ data: [], isLoading: false }));
    render(<DealCardChecklists leadId="lead-1" />);
    expect(screen.getByText(/Nenhum checklist neste negócio/)).toBeInTheDocument();
    expect(screen.getByText("Aplicar checklist")).toBeInTheDocument();
    expect(screen.getByText("Novo")).toBeInTheDocument();
  });

  it("negócio sem lead diz de quem seria a lista, em vez de abrir vazia", () => {
    render(<DealCardChecklists leadId={null} />);
    expect(screen.getByText(/checklist é da pessoa/)).toBeInTheDocument();
  });
});
