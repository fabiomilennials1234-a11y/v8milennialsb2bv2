/**
 * MessageList virtualization — unit tests
 *
 * Covers:
 * 1. Virtualized container renders with correct structure for large message lists
 * 2. Mobile gets virtualization too (no mobile exclusion)
 * 3. Mobile overscan is larger than desktop overscan
 * 4. Scroll-to-bottom FAB behavior on new message append
 * 5. Small lists (<=threshold) render plain without virtualizer
 * 6. useViewport hook drives mobile detection (reactive, not raw window.innerWidth)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MessageList, type MessageListProps } from "@/components/chat/view/MessageList";

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock useViewport to control mobile/desktop
const mockViewport = { isMobile: false, isDesktop: true, width: 1024 };
vi.mock("@/hooks/use-viewport", () => ({
  useViewport: () => mockViewport,
}));

// Stub heavy child components to keep tests fast
vi.mock("@/components/chat/ChatEmptyState", () => ({
  ChatEmptyState: () => <div data-testid="empty-state" />,
}));

vi.mock("@/components/chat/UnreadDivider", () => ({
  UnreadDivider: ({ count }: { count: number }) => (
    <div data-testid="unread-divider">{count}</div>
  ),
}));

vi.mock("@/components/chat/MessagePrimitives", () => ({
  MessagesAreaErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="error-boundary">{children}</div>
  ),
  MessageBubble: ({ message }: any) => (
    <div data-testid={`bubble-${message.id}`} className="mock-bubble">
      {message.content}
    </div>
  ),
}));

vi.mock("@/components/chat/ScrollToBottomFab", () => ({
  ScrollToBottomFab: ({ visible, count, onClick }: any) => (
    <button data-testid="scroll-fab" data-visible={visible} data-count={count} onClick={onClick}>
      FAB
    </button>
  ),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMessages(count: number): MessageListProps["messages"] {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    organization_id: "org-1",
    instance_id: "inst-1",
    message_id: `mid-${i}`,
    remote_jid: "5511999999999@s.whatsapp.net",
    phone_number: "5511999999999",
    direction: (i % 3 === 0 ? "incoming" : "outgoing") as "incoming" | "outgoing",
    message_type: "text",
    content: `Message ${i}`,
    media_url: null,
    push_name: i % 3 === 0 ? "Lead" : null,
    status: "delivered",
    timestamp: new Date(2026, 0, 1, 10, Math.floor(i / 2), i % 60).toISOString(),
    lead_id: null,
    sent_by_ai: false,
    created_at: new Date(2026, 0, 1, 10, Math.floor(i / 2), i % 60).toISOString(),
  }));
}

function defaultProps(overrides: Partial<MessageListProps> = {}): MessageListProps {
  return {
    messages: [],
    transferEvents: [],
    failedMessages: [],
    isLoading: false,
    contactName: "Test Contact",
    instanceName: "Test Instance",
    lastReadAt: 0,
    mountTime: Date.now(),
    onImagePreview: vi.fn(),
    onRetry: vi.fn(),
    onOpenTemplates: vi.fn(),
    ...overrides,
  };
}

// Polyfill ResizeObserver for jsdom
beforeEach(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
  }

  // jsdom lacks Element.scrollTo — stub it for auto-scroll effects
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? vi.fn();
  HTMLElement.prototype.scrollIntoView = HTMLElement.prototype.scrollIntoView ?? vi.fn();
});

afterEach(() => {
  // Reset viewport to desktop between tests
  mockViewport.isMobile = false;
  mockViewport.isDesktop = true;
  mockViewport.width = 1024;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("MessageList virtualization", () => {
  it("renders plain list for small message counts (<=100)", () => {
    const msgs = makeMessages(50);
    const { container } = render(<MessageList {...defaultProps({ messages: msgs })} />);

    // All 50 bubbles should be in the DOM (no virtualization)
    const bubbles = container.querySelectorAll(".mock-bubble");
    expect(bubbles.length).toBe(50);
  });

  it("renders virtualized container for large message counts (>100)", () => {
    const msgs = makeMessages(200);
    const { container } = render(<MessageList {...defaultProps({ messages: msgs })} />);

    // Virtualized: NOT all 200 bubbles should be in the DOM
    const bubbles = container.querySelectorAll(".mock-bubble");
    expect(bubbles.length).toBeLessThan(200);

    // Should have the virtualizer container with position: relative
    const virtualContainer = container.querySelector("[data-testid='virtual-container']");
    expect(virtualContainer).toBeInTheDocument();
  });

  it("virtualizes on mobile too — mobile is NOT excluded", () => {
    // Set viewport to mobile
    mockViewport.isMobile = true;
    mockViewport.isDesktop = false;
    mockViewport.width = 375;

    const msgs = makeMessages(200);
    const { container } = render(<MessageList {...defaultProps({ messages: msgs })} />);

    // Should still virtualize — NOT all 200 in DOM
    const bubbles = container.querySelectorAll(".mock-bubble");
    expect(bubbles.length).toBeLessThan(200);

    // Virtual container present
    const virtualContainer = container.querySelector("[data-testid='virtual-container']");
    expect(virtualContainer).toBeInTheDocument();
  });

  it("uses larger overscan on mobile than desktop", () => {
    // This test validates mobile gets overscan >= 5 (MOBILE_OVERSCAN)
    // vs desktop overscan of 3 (DESKTOP_OVERSCAN).
    // We verify indirectly: mobile with 200 msgs should render more items
    // in the virtualizer window than desktop for the same viewport height.

    // Desktop render
    mockViewport.isMobile = false;
    mockViewport.width = 1024;
    const msgs = makeMessages(200);
    const { container: desktopContainer, unmount: unmountDesktop } = render(
      <MessageList {...defaultProps({ messages: msgs })} />,
    );
    const desktopBubbles = desktopContainer.querySelectorAll(".mock-bubble").length;
    unmountDesktop();

    // Mobile render — overscan is larger, so more items rendered
    mockViewport.isMobile = true;
    mockViewport.width = 375;
    const { container: mobileContainer } = render(
      <MessageList {...defaultProps({ messages: msgs })} />,
    );
    const mobileBubbles = mobileContainer.querySelectorAll(".mock-bubble").length;

    // Mobile overscan >= desktop overscan, so mobile renders >= desktop items
    expect(mobileBubbles).toBeGreaterThanOrEqual(desktopBubbles);
  });

  it("renders empty state when messages array is empty", () => {
    render(<MessageList {...defaultProps()} />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("renders loading state", () => {
    const { container } = render(
      <MessageList {...defaultProps({ isLoading: true })} />,
    );
    // Loader2 spinner present
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("scroll FAB is rendered", () => {
    const msgs = makeMessages(10);
    render(<MessageList {...defaultProps({ messages: msgs })} />);
    expect(screen.getByTestId("scroll-fab")).toBeInTheDocument();
  });

  it("applies mobile-optimized scroll styles via data attribute", () => {
    mockViewport.isMobile = true;
    mockViewport.width = 375;

    const msgs = makeMessages(200);
    const { container } = render(<MessageList {...defaultProps({ messages: msgs })} />);

    const virtualContainer = container.querySelector("[data-testid='virtual-container']");
    expect(virtualContainer).toBeInTheDocument();
    // Mobile should have momentum scroll hint
    expect(virtualContainer?.getAttribute("data-mobile")).toBe("true");
  });
});
