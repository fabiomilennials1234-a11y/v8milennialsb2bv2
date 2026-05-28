/**
 * ScrollToBottomFab — unit tests
 *
 * Scenarios:
 * 1. Does NOT render when visible=false
 * 2. Renders button when visible=true
 * 3. count=0 — shows "Ir para o final" aria-label, no count text
 * 4. count=1 — singular "1 nova mensagem" in aria-label and text
 * 5. count=5 — plural "5 novas mensagens" in aria-label and text
 * 6. click fires onClick callback
 * 7. ArrowDown icon is present when visible
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScrollToBottomFab } from "@/modules/communication/components/chat/ScrollToBottomFab";

// framer-motion AnimatePresence renders children conditionally in tests
// without needing any mock — jsdom renders the motion.button synchronously.

describe("ScrollToBottomFab", () => {
  it("does not render when visible=false", () => {
    const { container } = render(
      <ScrollToBottomFab visible={false} count={0} onClick={vi.fn()} />,
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders button when visible=true", () => {
    render(<ScrollToBottomFab visible={true} count={0} onClick={vi.fn()} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("count=0 — aria-label is 'Ir para o final', no count text rendered", () => {
    render(<ScrollToBottomFab visible={true} count={0} onClick={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-label", "Ir para o final");
    expect(btn.textContent).not.toMatch(/nova/);
  });

  it("count=1 — shows singular '1 nova mensagem'", () => {
    render(<ScrollToBottomFab visible={true} count={1} onClick={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-label", "1 nova mensagem");
    expect(btn).toHaveTextContent(/1 nova\b/);
  });

  it("count=5 — shows plural '5 novas mensagens'", () => {
    render(<ScrollToBottomFab visible={true} count={5} onClick={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-label", "5 novas mensagens");
    expect(btn).toHaveTextContent(/5 novas\b/);
  });

  it("click fires onClick callback", () => {
    const handler = vi.fn();
    render(<ScrollToBottomFab visible={true} count={3} onClick={handler} />);
    fireEvent.click(screen.getByRole("button"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("has type=button to prevent form submission", () => {
    render(<ScrollToBottomFab visible={true} count={0} onClick={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});
