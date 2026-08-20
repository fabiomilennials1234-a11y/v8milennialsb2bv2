import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LeadCardMetrics } from "../LeadCardMetrics";
import { LeadCardChecklistPopover } from "../LeadCardChecklistPopover";

// ─── Mocks ────────────────────────────────────────────────────────────

const toggleMutate = vi.fn();

const leadChecklists = vi.fn((..._args: unknown[]) => ({
  data: [
    { id: "cl-1", title: "Qualificação", total_items: 2, completed_items: 1 },
  ],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

const checklistItems = vi.fn((..._args: unknown[]) => ({
  data: [
    { id: "it-1", checklist_id: "cl-1", title: "Confirmar telefone", is_completed: false },
    { id: "it-2", checklist_id: "cl-1", title: "Validar empresa", is_completed: true },
  ],
}));

vi.mock("@/modules/engagement", () => ({
  useLeadChecklists: (...args: unknown[]) => leadChecklists(...args),
  useChecklistItems: (...args: unknown[]) => checklistItems(...args),
  useToggleChecklistItem: () => ({ mutate: toggleMutate }),
}));

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  toggleMutate.mockClear();
  leadChecklists.mockClear();
  checklistItems.mockClear();
});

describe("LeadCardChecklistPopover", () => {
  it("renders the badge counter from props without opening the list", () => {
    renderWithClient(
      <LeadCardChecklistPopover leadId="lead-1" completed={1} total={2} />,
    );
    const trigger = screen.getByRole("button", {
      name: "Checklists: 1 de 2 itens concluídos",
    });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("1/2");
    // Lazy: popover content (and its query) is not mounted until opened.
    expect(leadChecklists).not.toHaveBeenCalled();
  });

  it("opens the popover and lists toggleable items on click", () => {
    renderWithClient(
      <LeadCardChecklistPopover leadId="lead-1" completed={1} total={2} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Checklists: 1 de 2/ }),
    );
    // Lazy query now enabled with the real leadId.
    expect(leadChecklists).toHaveBeenCalledWith("lead-1");
    expect(screen.getByText("Confirmar telefone")).toBeInTheDocument();
    expect(screen.getByText("Validar empresa")).toBeInTheDocument();
  });

  it("does not bubble the click to a parent handler (card root opens modal)", () => {
    const parentClick = vi.fn();
    renderWithClient(
      <div onClick={parentClick}>
        <LeadCardChecklistPopover leadId="lead-1" completed={1} total={2} />
      </div>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Checklists: 1 de 2/ }),
    );
    // Popover opens (badge interactive) mas o click NÃO sobe pro root → modal não abre.
    expect(screen.getByText("Confirmar telefone")).toBeInTheDocument();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("calls the toggle mutation when an item checkbox is clicked", () => {
    renderWithClient(
      <LeadCardChecklistPopover leadId="lead-1" completed={1} total={2} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Checklists: 1 de 2/ }),
    );
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    expect(toggleMutate).toHaveBeenCalledWith({
      id: "it-1",
      checklist_id: "cl-1",
      is_completed: true,
    });
  });
});

describe("LeadCardMetrics checklist badge gating", () => {
  it("renders the interactive popover trigger when leadId + total>0", () => {
    renderWithClient(
      <LeadCardMetrics leadId="lead-1" checklistsCompleted={1} checklistsTotal={2} />,
    );
    expect(
      screen.getByRole("button", { name: "Checklists: 1 de 2 itens concluídos" }),
    ).toBeInTheDocument();
  });

  // Contrato INVERTIDO de propósito. Antes, total===0 renderizava um chip
  // passivo — e isso criava um ponto cego: lead sem checklist não tinha por
  // onde abrir o painel, logo não tinha por onde APLICAR um. Pior, checklist
  // criado com zero itens conta 0/0, então existia no banco e era invisível.
  it("abre mesmo com total===0 — é por onde se aplica o primeiro checklist", () => {
    renderWithClient(
      <LeadCardMetrics leadId="lead-1" checklistsCompleted={0} checklistsTotal={0} />,
    );
    expect(
      screen.getByRole("button", { name: "Checklists: 0 de 0 itens concluídos" }),
    ).toBeInTheDocument();
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });

  it("renders a passive chip when leadId is missing even with total>0", () => {
    renderWithClient(
      <LeadCardMetrics checklistsCompleted={1} checklistsTotal={2} />,
    );
    expect(
      screen.queryByRole("button", { name: /Checklists:/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });
});
