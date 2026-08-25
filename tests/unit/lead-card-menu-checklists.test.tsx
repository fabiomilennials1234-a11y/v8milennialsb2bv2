/**
 * O item "Checklists" do menu do card do funil.
 *
 * Ele existia desde o redesenho do card e chamava `abrirFicha` — a mesma função
 * dos itens com selo FICHA. Resultado em tela: clicar em "Checklists" abria o
 * card do negócio na primeira aba e nada mais acontecia. O item prometia um
 * assunto e entregava outro, que é o que faz o menu inteiro perder a confiança.
 *
 * Aqui se prova a costura inteira, com o menu de verdade: o clique ABRE o
 * negócio (quem escolhe os ids é a superfície, via `onClick`) e PEDE a aba de
 * checklists — nessa ordem, porque abrir zera o pedido.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Só o que precisa de banco/identidade é trocado ──────────────────────────
vi.mock("@/modules/leads/components/leads/card/LeadCardQualificationPopover", () => ({
  LeadCardQualificationPopover: () => null,
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

describe("Menu do card do funil — Checklists", () => {
  it("abre o negócio E pede a aba de checklists", () => {
    // O `onClick` é o que cada superfície liga ao `openDeal` com os ids dela.
    montar(() => sheet.openDeal("entry-1", "lead-1"));
    abrirMenu();
    fireEvent.click(screen.getByText("Checklists"));

    expect(sheet.isOpen).toBe(true);
    expect(sheet.entryId).toBe("entry-1");
    expect(sheet.aba).toBe("checklists");
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
