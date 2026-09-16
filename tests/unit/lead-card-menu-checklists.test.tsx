/**
 * O item "Checklists" do menu do card do funil.
 *
 * Ele existia desde o redesenho do card e chamava `abrirFicha` — a mesma função
 * dos itens com selo FICHA. Resultado em tela: clicar em "Checklists" abria o
 * card do negócio na primeira aba e nada mais acontecia. O item prometia um
 * assunto e entregava outro, que é o que faz o menu inteiro perder a confiança.
 *
 * O clique abre um painel ao lado do card, sem abrir a ficha do negócio.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { toggle, apply, load } = vi.hoisted(() => ({
  toggle: vi.fn(),
  apply: vi.fn(),
  load: vi.fn(() => ({
    data: [
      { id: "cl-1", title: "Qualificação comercial", pipeline_entry_id: "entry-1", total_items: 2, completed_items: 1 },
      { id: "cl-2", title: "Checklist de outro negócio", pipeline_entry_id: "entry-2", total_items: 1, completed_items: 0 },
    ],
    isLoading: false,
  })),
}));

vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: () => undefined }));
vi.mock("@/modules/engagement", () => ({
  CreateMeetingDialog: () => null,
  useLeadChecklists: load,
  useChecklistItems: () => ({ data: [{ id: "item-1", title: "Confirmar telefone", is_completed: false }] }),
  useToggleChecklistItem: () => ({ mutate: toggle }),
  useChecklistTemplates: () => ({ data: [{ id: "tpl-1", title: "Primeiro contato", total_items: 3 }] }),
  useApplyChecklistTemplate: () => ({ mutate: apply, isPending: false }),
  useCreateChecklist: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateChecklistItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteChecklist: () => ({ mutate: vi.fn() }),
  useDeleteChecklistItem: () => ({ mutate: vi.fn() }),
}));

// ── Só o que precisa de banco/identidade é trocado ──────────────────────────
vi.mock("@/modules/leads/components/leads/card/LeadCardQualificationPopover", () => ({
  LeadCardQualificationPopover: () => null,
}));
vi.mock("@/modules/leads/components/etiquetas/LeadEtiquetasPopover", () => ({
  LeadEtiquetasPopover: () => null,
}));
vi.mock("@/modules/leads/components/leads/card/DealLostMenuItem", () => ({
  DealLostMenuItem: () => null,
}));
vi.mock("@/modules/communication/components/chat/ScheduleMessageModal", () => ({
  ScheduleMessageModal: () => null,
}));
vi.mock("@/modules/communication/components/chat/AbrirConversaButton", () => ({
  AbrirConversaButton: () => null,
}));
vi.mock("@/modules/communication/components/chat/AbrirConversaMenuItem", () => ({
  AbrirConversaMenuItem: () => null,
}));
vi.mock("@/modules/leads/components/leads/AddToFunilDialog", () => ({
  AddToFunilMenuItem: () => null,
  AddToFunilDialog: () => null,
}));

import { LeadCard } from "@/modules/leads/components/leads/LeadCard";
import { DealPanelProvider } from "@/modules/leads/components/deal-detail/DealPanelProvider";
import { useDealSheet } from "@/modules/leads/components/deal-detail/deal-sheet-context";

const LEAD = {
  id: "entry-1",
  leadId: "lead-1",
  name: "Distética Suplementos",
  company: "Distética Comércio",
  phone: null,
  metrics: { commentsCount: 0, checklistsCompleted: 1, checklistsTotal: 4 },
};

let sheet: ReturnType<typeof useDealSheet>;
function Espiao() {
  sheet = useDealSheet();
  return null;
}

function montar(onClick: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DealPanelProvider>
        <Espiao />
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <LeadCard lead={LEAD as any} density="compact" onClick={onClick} />
      </DealPanelProvider>
    </QueryClientProvider>,
  );
}

/**
 * O gatilho do Radix abre no `pointerdown`, não no `click` — e o jsdom não tem
 * PointerEvent. `fireEvent.pointerDown` com `button: 0` é o que o handler dele
 * espera; `fireEvent.click` sozinho não abre nada e o teste falharia por um
 * motivo que não é o do arquivo.
 */
function abrirMenu() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: /Opções de Distética/ }),
    { button: 0, ctrlKey: false, pointerType: "mouse" },
  );
}

beforeEach(() => vi.clearAllMocks());

describe("Menu do card do funil — Checklists", () => {
  it("abre o painel lateral sem abrir o negócio nem disparar o clique do card", () => {
    const abrirFicha = vi.fn(() => sheet.openDeal("entry-1", "lead-1"));
    montar(abrirFicha);
    expect(load).not.toHaveBeenCalled();
    abrirMenu();
    fireEvent.click(screen.getByText("Checklists"));

    expect(screen.getByRole("dialog", { name: "Checklists" })).toBeInTheDocument();
    expect(screen.getByText("Qualificação comercial")).toBeInTheDocument();
    expect(screen.queryByText("Checklist de outro negócio")).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledWith("lead-1");
    expect(abrirFicha).not.toHaveBeenCalled();
    expect(sheet.isOpen).toBe(false);
    expect(sheet.aba).toBeNull();
  });

  it("permite marcar itens e aplicar modelos no negócio do card", () => {
    const abrirFicha = vi.fn();
    montar(abrirFicha);
    abrirMenu();
    fireEvent.click(screen.getByText("Checklists"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Confirmar telefone" }));
    expect(toggle).toHaveBeenCalledWith({ id: "item-1", checklist_id: "cl-1", is_completed: true });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar checklist" }));
    fireEvent.click(screen.getByRole("button", { name: /Primeiro contato/ }));
    expect(apply).toHaveBeenCalledWith({ templateId: "tpl-1", leadId: "lead-1", entryId: "entry-1" }, expect.anything());
    expect(abrirFicha).not.toHaveBeenCalled();
    expect(sheet.isOpen).toBe(false);
  });

  it("fecha no X e devolve o foco ao botão +", async () => {
    montar(vi.fn());
    abrirMenu();
    fireEvent.click(screen.getByText("Checklists"));
    fireEvent.click(screen.getByRole("button", { name: "Fechar checklists" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: /Opções de Distética/ })).toHaveFocus());
  });

  it("abre por teclado e fecha com Escape", async () => {
    const user = userEvent.setup();
    montar(vi.fn());
    const trigger = screen.getByRole("button", { name: /Opções de Distética/ });
    trigger.focus();
    await user.keyboard("{Enter}");
    screen.getByRole("menuitem", { name: /Checklists/ }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Checklists" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("os itens com selo FICHA continuam só abrindo — eles não pedem aba", () => {
    montar(() => sheet.openDeal("entry-1", "lead-1"));
    abrirMenu();
    fireEvent.click(screen.getByText("Qualificação"));

    expect(sheet.isOpen).toBe(true);
    expect(sheet.aba).toBeNull();
  });

  it("o contador do item vem das métricas do card", () => {
    montar(() => {});
    abrirMenu();
    expect(screen.getByText("1/4")).toBeInTheDocument();
  });
});
