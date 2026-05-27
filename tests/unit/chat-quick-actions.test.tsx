/**
 * ChatQuickActions — TDD test suite.
 *
 * Cycles:
 *  1. Renders 3 buttons (audio, template, attach)
 *  2. onAudio fires on click
 *  3. onTemplate fires on click
 *  4. onAttach fires on click
 *  5. All buttons disabled when disabled=true
 *  6. Touch targets min 44x44px
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatQuickActions } from "@/modules/communication/components/chat/composer/ChatQuickActions";

const createProps = () => ({
  onAudio: vi.fn(),
  onTemplate: vi.fn(),
  onAttach: vi.fn(),
});

describe("ChatQuickActions", () => {
  let props: ReturnType<typeof createProps>;

  beforeEach(() => {
    props = createProps();
  });

  // ─── Cycle 1: renders 3 buttons ──────────────────────────
  it("renders audio, template, and attach buttons", () => {
    render(<ChatQuickActions {...props} />);

    expect(screen.getByLabelText("Gravar áudio")).toBeInTheDocument();
    expect(screen.getByLabelText("Template rápido")).toBeInTheDocument();
    expect(screen.getByLabelText("Anexar arquivo")).toBeInTheDocument();
  });

  // ─── Cycle 2: onAudio callback ──────────────────────────
  it("calls onAudio when audio button clicked", () => {
    render(<ChatQuickActions {...props} />);
    fireEvent.click(screen.getByLabelText("Gravar áudio"));
    expect(props.onAudio).toHaveBeenCalledOnce();
  });

  // ─── Cycle 3: onTemplate callback ───────────────────────
  it("calls onTemplate when template button clicked", () => {
    render(<ChatQuickActions {...props} />);
    fireEvent.click(screen.getByLabelText("Template rápido"));
    expect(props.onTemplate).toHaveBeenCalledOnce();
  });

  // ─── Cycle 4: onAttach callback ─────────────────────────
  it("calls onAttach when attach button clicked", () => {
    render(<ChatQuickActions {...props} />);
    fireEvent.click(screen.getByLabelText("Anexar arquivo"));
    expect(props.onAttach).toHaveBeenCalledOnce();
  });

  // ─── Cycle 5: disabled state ────────────────────────────
  it("disables all buttons when disabled=true", () => {
    render(<ChatQuickActions {...props} disabled />);

    expect(screen.getByLabelText("Gravar áudio")).toBeDisabled();
    expect(screen.getByLabelText("Template rápido")).toBeDisabled();
    expect(screen.getByLabelText("Anexar arquivo")).toBeDisabled();
  });

  it("does not fire callbacks when disabled", () => {
    render(<ChatQuickActions {...props} disabled />);

    fireEvent.click(screen.getByLabelText("Gravar áudio"));
    fireEvent.click(screen.getByLabelText("Template rápido"));
    fireEvent.click(screen.getByLabelText("Anexar arquivo"));

    expect(props.onAudio).not.toHaveBeenCalled();
    expect(props.onTemplate).not.toHaveBeenCalled();
    expect(props.onAttach).not.toHaveBeenCalled();
  });

  // ─── Cycle 6: touch targets ─────────────────────────────
  it("buttons have min-w-[44px] and min-h-[44px] classes for touch targets", () => {
    render(<ChatQuickActions {...props} />);

    const buttons = [
      screen.getByLabelText("Gravar áudio"),
      screen.getByLabelText("Template rápido"),
      screen.getByLabelText("Anexar arquivo"),
    ];

    for (const btn of buttons) {
      expect(btn.className).toMatch(/min-w-\[44px\]/);
      expect(btn.className).toMatch(/min-h-\[44px\]/);
    }
  });
});
