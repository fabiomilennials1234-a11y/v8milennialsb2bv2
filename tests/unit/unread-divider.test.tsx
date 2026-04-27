/**
 * UnreadDivider — unit tests
 *
 * Scenarios:
 * 1. count=1 — singular "1 não lida"
 * 2. count=3 — plural "3 não lidas"
 * 3. count=1 — aria-label singular form
 * 4. count=5 — aria-label plural form
 * 5. role="separator" is set
 * 6. divider lines are rendered (two hr-equivalent elements)
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnreadDivider } from "@/components/chat/UnreadDivider";

describe("UnreadDivider", () => {
  it("count=1 — shows singular 'não lida'", () => {
    render(<UnreadDivider count={1} />);
    expect(screen.getByText(/1 não lida/i)).toBeInTheDocument();
    expect(screen.queryByText(/não lidas/i)).toBeNull();
  });

  it("count=3 — shows plural 'não lidas'", () => {
    render(<UnreadDivider count={3} />);
    expect(screen.getByText(/3 não lidas/i)).toBeInTheDocument();
  });

  it("count=1 — aria-label uses singular form", () => {
    const { container } = render(<UnreadDivider count={1} />);
    const separator = container.querySelector('[role="separator"]');
    expect(separator).toHaveAttribute(
      "aria-label",
      "1 mensagem não lida",
    );
  });

  it("count=5 — aria-label uses plural form", () => {
    const { container } = render(<UnreadDivider count={5} />);
    const separator = container.querySelector('[role="separator"]');
    expect(separator).toHaveAttribute(
      "aria-label",
      "5 mensagens não lidas",
    );
  });

  it("has role=separator", () => {
    const { container } = render(<UnreadDivider count={2} />);
    expect(container.querySelector('[role="separator"]')).toBeInTheDocument();
  });

  it("renders two decorative line divs", () => {
    const { container } = render(<UnreadDivider count={2} />);
    // Two flex-1 h-px divs flanking the text
    const lines = container.querySelectorAll(".flex-1.h-px");
    expect(lines).toHaveLength(2);
  });

  it("label text is uppercased via CSS class (uppercase tracking-wider)", () => {
    const { container } = render(<UnreadDivider count={2} />);
    const label = container.querySelector(".uppercase");
    expect(label).toBeInTheDocument();
  });
});
