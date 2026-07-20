import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { SupportRealtimeLaunchModal } from "./SupportRealtimeLaunchModal";
import {
  SupportPanelContext,
  type SupportPanelContextType,
} from "../SupportPanelContext";

const panelCtx: SupportPanelContextType = {
  isOpen: false,
  ticketId: null,
  composing: false,
  open: vi.fn(),
  openNewTicket: vi.fn(),
  openTicket: vi.fn(),
  backToList: vi.fn(),
  close: vi.fn(),
};

function renderModal(onClose: () => void) {
  return render(
    <SupportPanelContext.Provider value={panelCtx}>
      <SupportRealtimeLaunchModal onClose={onClose} />
    </SupportPanelContext.Provider>,
  );
}

const HEADING = "Suporte, agora em tempo real";

describe("SupportRealtimeLaunchModal", () => {
  it("some da tela ao clicar em 'Explorar depois'", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal(onClose);

    expect(await screen.findByText(HEADING)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /explorar depois/i }));

    expect(onClose).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText(HEADING)).not.toBeInTheDocument(),
    );
  });

  it("some da tela ao clicar no X de fechar", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal(onClose);

    expect(await screen.findByText(HEADING)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(onClose).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText(HEADING)).not.toBeInTheDocument(),
    );
  });
});
