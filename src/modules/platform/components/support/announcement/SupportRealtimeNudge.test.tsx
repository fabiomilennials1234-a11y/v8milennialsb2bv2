import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { SupportRealtimeNudge } from "./SupportRealtimeNudge";
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

function renderNudge(onDismissForever: () => void) {
  return render(
    <SupportPanelContext.Provider value={panelCtx}>
      <SupportRealtimeNudge onDismissForever={onDismissForever} />
    </SupportPanelContext.Provider>,
  );
}

const TITLE = "Suporte ao vivo";

describe("SupportRealtimeNudge", () => {
  it("some da tela ao clicar no X (Dispensar)", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    renderNudge(onDismiss);

    expect(screen.getByText(TITLE)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /dispensar/i }));

    expect(onDismiss).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText(TITLE)).not.toBeInTheDocument(),
    );
  });

  it("some da tela ao clicar em 'Agora não'", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    renderNudge(onDismiss);

    expect(screen.getByText(TITLE)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /agora não/i }));

    expect(onDismiss).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText(TITLE)).not.toBeInTheDocument(),
    );
  });
});
