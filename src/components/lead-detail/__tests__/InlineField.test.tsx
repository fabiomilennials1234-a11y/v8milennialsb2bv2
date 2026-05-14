import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InlineField } from "../InlineField";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("InlineField", () => {
  it("renders label and value in display mode", () => {
    render(<InlineField label="Origin" value="Meta Ads" onSave={vi.fn()} />);
    expect(screen.getByText("Origin")).toBeInTheDocument();
    expect(screen.getByText("Meta Ads")).toBeInTheDocument();
  });

  it("shows input on value click", () => {
    render(<InlineField label="Origin" value="Meta Ads" onSave={vi.fn()} />);
    fireEvent.click(screen.getByText("Meta Ads"));
    expect(screen.getByDisplayValue("Meta Ads")).toBeInTheDocument();
  });

  it("saves on Enter key", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineField label="Origin" value="Meta Ads" onSave={onSave} />);
    fireEvent.click(screen.getByText("Meta Ads"));
    const input = screen.getByDisplayValue("Meta Ads");
    fireEvent.change(input, { target: { value: "Orgânico" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Orgânico"));
  });

  it("cancels on Escape key", () => {
    render(<InlineField label="Origin" value="Meta Ads" onSave={vi.fn()} />);
    fireEvent.click(screen.getByText("Meta Ads"));
    const input = screen.getByDisplayValue("Meta Ads");
    fireEvent.change(input, { target: { value: "changed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByText("Meta Ads")).toBeInTheDocument();
  });

  it("renders placeholder when value is empty", () => {
    render(<InlineField label="Segmento" value="" onSave={vi.fn()} placeholder="Adicionar..." />);
    expect(screen.getByText("Adicionar...")).toBeInTheDocument();
  });
});
