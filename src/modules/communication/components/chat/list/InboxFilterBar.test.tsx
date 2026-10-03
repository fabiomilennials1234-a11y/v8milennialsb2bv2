import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InboxFilterBar, InboxActiveFiltersButton } from "./InboxFilterBar";
import { DEFAULT_INBOX_FILTER } from "@/modules/communication/lib/inboxFilter";

// Radix (Popover) precisa desses no jsdom.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function baseProps(overrides = {}) {
  return {
    filter: DEFAULT_INBOX_FILTER,
    patch: vi.fn(),
    toggleMulti: vi.fn(),
    clearFilter: vi.fn(),
    waitingHumanCount: 0,
    funnelOptions: [
      { pipelineId: "p1", label: "Oportunidades", stages: [{ stageKey: "novo", label: "Novo" }] },
    ],
    vendorOptions: [{ id: "v1", name: "Eduardo" }],
    currentTeamMemberId: "me",
    canSeeUnassigned: true,
    allTags: [{ id: "t1", name: "Ouro", color: "#fff" }],
    ...overrides,
  };
}

function setup(overrides = {}) {
  const props = baseProps(overrides);
  return { props, ...render(<InboxFilterBar {...props} />) };
}

describe("InboxFilterBar — o trilho", () => {
  // V5 (02/10): as dimensões saíram de trás do "+ Filtro" e ficam sempre
  // visíveis; "Não lidas" foi para o alternador Todas · Não lidas · Grupos e
  // "Nova conversa" para o ícone do cabeçalho do inbox.
  it("expõe atalhos e dimensões numa linha só, sem '+ Filtro', 'Não lidas' nem 'Nova Conversa'", () => {
    setup({ onNewConversation: vi.fn() });
    const trilho = screen.getByRole("group", { name: "Filtros do inbox" });
    for (const nome of ["Minhas conversas", "Não atribuídas", "Aguardando resposta", "Pediu atendente", "Com lead", "Sem lead"]) {
      expect(within(trilho).getByRole("button", { name: nome })).toBeInTheDocument();
    }
    for (const dim of ["funil", "etapa", "tag", "vendedor", "fonte", "qualificação"]) {
      expect(within(trilho).getByRole("button", { name: `Filtrar por ${dim}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /^\+?\s*Filtro$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Não lidas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nova Conversa/i })).not.toBeInTheDocument();
  });

  it("'Não atribuídas' só existe para quem pode ver conversa sem dono", () => {
    setup({ canSeeUnassigned: false });
    expect(screen.queryByRole("button", { name: "Não atribuídas" })).not.toBeInTheDocument();
  });

  it("clicar Funil abre o editor e escolher a opção chama toggleMulti (regressão: clicar Funil não fazia nada)", async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.click(screen.getByRole("button", { name: "Filtrar por funil" }));
    await user.click(await screen.findByText("Oportunidades"));

    expect(props.toggleMulti).toHaveBeenCalledWith("funnels", "p1");
  });

  it("toggle 'Aguardando resposta' ativa direto via patch", async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.click(screen.getByRole("button", { name: "Aguardando resposta" }));

    expect(props.patch).toHaveBeenCalledWith({ waiting: true });
  });

  it("'Minhas conversas' é o vendedor 'mine' — liga e desliga", async () => {
    const user = userEvent.setup();
    const { props, rerender } = setup();

    await user.click(screen.getByRole("button", { name: "Minhas conversas" }));
    expect(props.patch).toHaveBeenCalledWith({ vendor: "mine" });

    rerender(<InboxFilterBar {...props} filter={{ ...DEFAULT_INBOX_FILTER, vendor: "mine" }} />);
    expect(screen.getByRole("button", { name: "Minhas conversas" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Minhas conversas" }));
    expect(props.patch).toHaveBeenLastCalledWith({ vendor: "all" });
  });

  it("'Pediu atendente' mostra o tamanho da fila", () => {
    setup({ waitingHumanCount: 3 });
    expect(within(screen.getByRole("button", { name: /Pediu atendente/ })).getByText("3")).toBeInTheDocument();
  });

  it("chip de dimensão ativa (com valor) renderiza o resumo e remove limpando funil + etapa", () => {
    const { props } = setup({ filter: { ...DEFAULT_INBOX_FILTER, funnels: ["p1"] } });
    expect(screen.getByText("Funil:")).toBeInTheDocument();
    expect(screen.getByText("Oportunidades")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remover filtro Funil"));
    expect(props.patch).toHaveBeenCalledWith({ funnels: [], stages: [] });
  });
});

it("preserves labels and stage chips of a saved hidden funnel filter", () => {
  const { props } = setup({
    filter: { ...DEFAULT_INBOX_FILTER, funnels: ["hidden"], stages: ["hidden-stage"] },
    funnelOptions: [{ pipelineId: "hidden", label: "Funil preservado", isVisible: false, stages: [{ stageKey: "hidden-stage", label: "Etapa preservada" }] }],
  });
  expect(screen.getByText("Funil preservado")).toBeInTheDocument();
  expect(screen.getByText("Etapa preservada")).toBeInTheDocument();
  expect(props.patch).not.toHaveBeenCalled();
});

it("does not offer hidden funnels in the funnel editor", async () => {
  const user = userEvent.setup();
  setup({ funnelOptions: [{ pipelineId: "hidden", label: "Funil oculto", isVisible: false, stages: [] }] });
  await user.click(screen.getByRole("button", { name: "Filtrar por funil" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.queryByText("Funil oculto")).not.toBeInTheDocument();
});

describe("InboxActiveFiltersButton — o ícone Filtros do cabeçalho", () => {
  function montar(overrides = {}) {
    const props = baseProps(overrides);
    render(
      <TooltipProvider>
        <InboxActiveFiltersButton {...props} />
      </TooltipProvider>,
    );
    return props;
  }

  it("conta os filtros ligados — inclusive 'Não lidas' — e lista cada um", async () => {
    const user = userEvent.setup();
    montar({ filter: { ...DEFAULT_INBOX_FILTER, unread: true, funnels: ["p1"] } });

    await user.click(screen.getByRole("button", { name: "Filtros ativos: 2" }));

    expect(await screen.findByText("Não lidas")).toBeInTheDocument();
    expect(screen.getByText("Oportunidades")).toBeInTheDocument();
  });

  it("'Limpar todos os filtros' chama clearFilter", async () => {
    const user = userEvent.setup();
    const props = montar({ filter: { ...DEFAULT_INBOX_FILTER, waiting: true } });

    await user.click(screen.getByRole("button", { name: "Filtros ativos: 1" }));
    await user.click(await screen.findByText("Limpar todos os filtros"));

    expect(props.clearFilter).toHaveBeenCalledOnce();
  });

  it("sem filtro ligado, diz onde ficam os atalhos", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("button", { name: "Filtros" }));

    expect(await screen.findByText(/Nenhum filtro ligado/)).toBeInTheDocument();
  });
});
