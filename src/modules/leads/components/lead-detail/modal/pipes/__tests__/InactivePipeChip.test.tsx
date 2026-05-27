import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InactivePipeChip } from "../InactivePipeChip";

describe("InactivePipeChip", () => {
  it("opens popover and triggers onAdd on confirm", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(
      <InactivePipeChip
        label="Confirmação"
        shortLabel="Confirmação"
        isAdding={false}
        onAdd={onAdd}
      />,
    );
    fireEvent.click(screen.getByTestId("inactive-pipe-chip-Confirmação"));
    const confirmBtn = await screen.findByTestId(
      "inactive-pipe-chip-confirm-Confirmação",
    );
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
  });

  it("shows disabled reason instead of action button when disabled", async () => {
    render(
      <InactivePipeChip
        label="Carteira"
        shortLabel="Carteira"
        isAdding={false}
        onAdd={vi.fn()}
        disabled
        disabledReason="Disponível só quando há venda fechada"
      />,
    );
    fireEvent.click(screen.getByTestId("inactive-pipe-chip-Carteira"));
    expect(
      await screen.findByText(/disponível só quando há venda fechada/i),
    ).toBeInTheDocument();
  });
});
