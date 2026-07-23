import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InboxFilterBar } from "./InboxFilterBar";
import { DEFAULT_INBOX_FILTER } from "@/modules/communication/lib/inboxFilter";

// Radix (Popover) precisa desses no jsdom.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function setup(overrides = {}) {
  const props = {
    filter: DEFAULT_INBOX_FILTER,
    patch: vi.fn(),
    toggleMulti: vi.fn(),
    clearFilter: vi.fn(),
    unreadCount: 5,
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
  return { props, ...render(<InboxFilterBar {...props} />) };
}

describe("InboxFilterBar", () => {
  it("escolher uma dimensão multi no menu cria o chip (regressão: clicar Funil não fazia nada)", async () => {
    setup();

    // Sem chip no início.
    expect(screen.queryByLabelText("Remover filtro Funil")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Filtro/i }));
    fireEvent.click(await screen.findByText("Funil"));

    // Antes do fix: clicar em Funil não fazia nada. Agora o chip nasce
    // (com seu botão de remover) mesmo antes de escolher um valor.
    await waitFor(() =>
      expect(screen.getByLabelText("Remover filtro Funil")).toBeInTheDocument(),
    );
  });

  it("toggle 'Aguardando resposta' ativa direto via patch", async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.click(screen.getByRole("button", { name: /Filtro/i }));
    await user.click(await screen.findByText("Aguardando resposta"));

    expect(props.patch).toHaveBeenCalledWith({ waiting: true });
  });

  it("toggle 'Não lidas' mostra a contagem e chama patch", async () => {
    const user = userEvent.setup();
    const { props } = setup();

    expect(screen.getByText("5")).toBeInTheDocument(); // unreadCount badge
    await user.click(screen.getByRole("button", { name: /Não lidas/i }));
    expect(props.patch).toHaveBeenCalledWith({ unread: true });
  });

  it("chip de dimensão ativa (com valor) renderiza o resumo", () => {
    setup({ filter: { ...DEFAULT_INBOX_FILTER, funnels: ["p1"] } });
    expect(screen.getByText("Funil:")).toBeInTheDocument();
    expect(screen.getByText("Oportunidades")).toBeInTheDocument();
  });
});
