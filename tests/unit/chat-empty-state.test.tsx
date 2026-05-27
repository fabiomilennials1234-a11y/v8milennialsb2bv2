/**
 * ChatEmptyState — unit tests
 *
 * Scenarios:
 * 1. Renders with contactName
 * 2. Renders with contactName + instanceName
 * 3. Does NOT render instanceName when omitted
 * 4. "Ver templates" button click fires onOpenTemplates
 * 5. Keyboard hint for "/" is present
 * 6. Snapshot regression
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatEmptyState } from "@/modules/communication/components/chat/ChatEmptyState";

describe("ChatEmptyState", () => {
  it("renders contact name", () => {
    render(
      <ChatEmptyState
        contactName="João Silva"
        onOpenTemplates={vi.fn()}
      />,
    );
    expect(screen.getByText(/João Silva/)).toBeInTheDocument();
  });

  it("renders instance name when provided", () => {
    render(
      <ChatEmptyState
        contactName="Maria"
        instanceName="Inbox Principal"
        onOpenTemplates={vi.fn()}
      />,
    );
    expect(screen.getByText(/Inbox Principal/)).toBeInTheDocument();
  });

  it("does NOT render instance text when instanceName is omitted", () => {
    render(
      <ChatEmptyState
        contactName="Carlos"
        onOpenTemplates={vi.fn()}
      />,
    );
    expect(screen.queryByText(/no inbox/)).not.toBeInTheDocument();
  });

  it("clicking 'Ver templates' fires onOpenTemplates", () => {
    const handler = vi.fn();
    render(
      <ChatEmptyState
        contactName="Lead"
        onOpenTemplates={handler}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ver templates/i }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("renders keyboard hint for slash command", () => {
    render(
      <ChatEmptyState
        contactName="Lead"
        onOpenTemplates={vi.fn()}
      />,
    );
    // The <kbd> element should contain "/"
    const kbd = screen.getByText("/");
    expect(kbd.tagName.toLowerCase()).toBe("kbd");
  });

  it("renders 'Comece a conversa' heading", () => {
    render(
      <ChatEmptyState
        contactName="Lead"
        onOpenTemplates={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Comece a conversa/i }),
    ).toBeInTheDocument();
  });
});
