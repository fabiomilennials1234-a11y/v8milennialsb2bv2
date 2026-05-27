import { render, screen, fireEvent } from "@testing-library/react";
import { ActionPill } from "../ActionPill";

describe("ActionPill", () => {
  it("renders meeting label and compact date for a future date", () => {
    const dt = new Date();
    dt.setDate(dt.getDate() + 3);
    dt.setHours(14, 30, 0, 0);
    render(<ActionPill type="meeting" value={dt.toISOString()} isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText("Reunião")).toBeInTheDocument();
    // compact format dd/MM · HHhmm — should not show "Hoje" or "Amanhã"
    const label = screen.getByText(/\d{2}\/\d{2}/);
    expect(label).toBeInTheDocument();
  });

  it("renders meeting `a definir` style label as muted when no date", () => {
    render(<ActionPill type="meeting" value={null} isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText(/sem data/i)).toBeInTheDocument();
  });

  it("renders budget compact currency", () => {
    render(<ActionPill type="budget" value={12500} isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText("Orçamento")).toBeInTheDocument();
    expect(screen.getByText(/R\$/)).toBeInTheDocument();
  });

  it("renders budget muted 'a definir' when value is 0/null", () => {
    render(<ActionPill type="budget" value={null} isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText(/a definir/i)).toBeInTheDocument();
  });

  it("invokes onToggle on click and reflects aria-expanded", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ActionPill type="meeting" value={null} isOpen={false} onToggle={onToggle} />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalled();
    rerender(<ActionPill type="meeting" value={null} isOpen onToggle={onToggle} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });
});
