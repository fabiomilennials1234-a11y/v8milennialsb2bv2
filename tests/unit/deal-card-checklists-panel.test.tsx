/**
 * O painel de checklists dentro do Card do Negócio.
 *
 * ── O ESCOPO É O NEGÓCIO (decisão do CTO, 2026-08-25) ─────────────────────
 * `checklists` ganhou `pipeline_entry_id`. O painel mostra DOIS grupos:
 *
 *   · **deste negócio** — vale só para este card;
 *   · **da pessoa** (`pipeline_entry_id` nulo) — vale para todos os negócios.
 *
 * O que pertence a OUTRO negócio do mesmo lead não é listado: seria mostrar
 * trabalho de outro card como se fosse deste. Aparece como contagem no pé.
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
const criarMutate = vi.fn().mockResolvedValue({ id: "cl-novo" });

const ENTRY = "entry-1";
const OUTRA_ENTRY = "entry-2";

const checklistsDoLead = vi.fn(() => ({
  data: [
    { id: "cl-1", title: "Qualificação", total_items: 2, completed_items: 1, pipeline_entry_id: ENTRY },
  ],
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
  useCreateChecklist: () => ({ mutateAsync: criarMutate, isPending: false }),
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
  criarMutate.mockClear();
  checklistsDoLead.mockImplementation(() => ({
    data: [
      { id: "cl-1", title: "Qualificação", total_items: 2, completed_items: 1, pipeline_entry_id: ENTRY },
    ],
    isLoading: false,
  }));
});

describe("DealCardChecklists", () => {
  it("lista os checklists do lead com os itens marcáveis", () => {
    render(<DealCardChecklists leadId="lead-1" entryId={ENTRY} />);
    expect(checklistsDoLead).toHaveBeenCalledWith("lead-1");
    expect(screen.getByText("Qualificação")).toBeInTheDocument();
    expect(screen.getByText("Confirmar telefone")).toBeInTheDocument();
  });

  it("marcar um item vai para a mutation com o checklist a que ele pertence", () => {
    render(<DealCardChecklists leadId="lead-1" entryId={ENTRY} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Confirmar telefone" }));
    expect(toggleMutate).toHaveBeenCalledWith({
      id: "it-1",
      checklist_id: "cl-1",
      is_completed: true,
    });
  });

  it("aplica um dos checklists da operação ao lead", () => {
    render(<DealCardChecklists leadId="lead-1" entryId={ENTRY} />);
    fireEvent.click(screen.getByText("Aplicar checklist"));
    fireEvent.click(screen.getByText("Onboarding do cliente"));
    expect(applyMutate).toHaveBeenCalledWith(
      // O template é aplicado NO NEGÓCIO aberto, não na pessoa.
      { templateId: "tpl-1", leadId: "lead-1", entryId: ENTRY },
      expect.anything(),
    );
  });

  it("sem checklist nenhum, o vazio explica as duas saídas em vez de só acusar falta", () => {
    checklistsDoLead.mockImplementation(() => ({ data: [], isLoading: false }));
    render(<DealCardChecklists leadId="lead-1" entryId={ENTRY} />);
    expect(screen.getByText(/Nenhum checklist neste negócio/)).toBeInTheDocument();
    expect(screen.getByText("Aplicar checklist")).toBeInTheDocument();
    expect(screen.getByText("Novo")).toBeInTheDocument();
  });

  it("negócio sem lead diz de quem seria a lista, em vez de abrir vazia", () => {
    render(<DealCardChecklists leadId={null} entryId={ENTRY} />);
    expect(screen.getByText(/checklist é da pessoa/)).toBeInTheDocument();
  });
});

describe("DealCardChecklists — os dois escopos", () => {
  it("separa o que é deste negócio do que é da pessoa", () => {
    checklistsDoLead.mockImplementation(() => ({
      data: [
        { id: "cl-1", title: "Fechamento", total_items: 1, completed_items: 0, pipeline_entry_id: ENTRY },
        { id: "cl-2", title: "Cadastro", total_items: 1, completed_items: 1, pipeline_entry_id: null },
      ],
      isLoading: false,
    }));
    render(<DealCardChecklists leadId="lead-1" entryId={ENTRY} />);

    expect(screen.getByText("Deste negócio")).toBeInTheDocument();
    expect(screen.getByText("Da pessoa")).toBeInTheDocument();
    expect(screen.getByText(/valem para todos os negócios/)).toBeInTheDocument();
    expect(screen.getByText("Fechamento")).toBeInTheDocument();
    expect(screen.getByText("Cadastro")).toBeInTheDocument();
  });

  it("NÃO lista o checklist de outro negócio — só diz que existe", () => {
    checklistsDoLead.mockImplementation(() => ({
      data: [
        { id: "cl-1", title: "Deste", total_items: 1, completed_items: 0, pipeline_entry_id: ENTRY },
        { id: "cl-9", title: "Do outro negócio", total_items: 1, completed_items: 0, pipeline_entry_id: OUTRA_ENTRY },
      ],
      isLoading: false,
    }));
    render(<DealCardChecklists leadId="lead-1" entryId={ENTRY} />);

    expect(screen.queryByText("Do outro negócio")).not.toBeInTheDocument();
    expect(screen.getByText(/1 checklist em outro negócio desta pessoa/)).toBeInTheDocument();
  });

  it("criar daqui nasce DESTE negócio", async () => {
    render(<DealCardChecklists leadId="lead-1" entryId={ENTRY} />);
    fireEvent.click(screen.getByText("Novo"));
    const campo = screen.getByPlaceholderText("Título do checklist…");
    fireEvent.change(campo, { target: { value: "Pós-venda" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(criarMutate).toHaveBeenCalledWith({
      title: "Pós-venda",
      lead_id: "lead-1",
      pipeline_entry_id: ENTRY,
    });
  });

  it("sem negócio identificado, a aba degrada para a lista inteira", () => {
    checklistsDoLead.mockImplementation(() => ({
      data: [
        { id: "cl-1", title: "Deste", total_items: 1, completed_items: 0, pipeline_entry_id: ENTRY },
        { id: "cl-2", title: "Da pessoa", total_items: 1, completed_items: 0, pipeline_entry_id: null },
      ],
      isLoading: false,
    }));
    render(<DealCardChecklists leadId="lead-1" entryId={null} />);

    expect(screen.queryByText("Deste negócio")).not.toBeInTheDocument();
    expect(screen.getByText("Deste")).toBeInTheDocument();
    expect(screen.getByText("Da pessoa")).toBeInTheDocument();
  });
});
