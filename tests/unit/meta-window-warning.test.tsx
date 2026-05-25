// tests/unit/meta-window-warning.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetaWindowWarning } from "@/components/chat-meta/MetaWindowWarning";

describe("MetaWindowWarning", () => {
  it("renders when lastInboundAt is older than 24h", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    render(<MetaWindowWarning lastInboundAt={old} />);
    expect(screen.getByText(/janela de 24 horas/i)).toBeInTheDocument();
  });

  it("does not render when within 24h", () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { container } = render(<MetaWindowWarning lastInboundAt={recent} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render when no inbound yet", () => {
    const { container } = render(<MetaWindowWarning lastInboundAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
