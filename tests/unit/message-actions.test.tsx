/**
 * Sprint 1 — message actions unit tests.
 *
 * Covers:
 *  - useMessageActions hooks mutations and onSuccess invalidation
 *  - isFeatureUnavailable helper
 *  - MessageMetaBadges rendering (edited, pinned, reactions, deleted)
 *  - DeletedPlaceholder render condition
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";

// Mock whatsappApi
vi.mock("@/lib/whatsappApi", () => ({
  reactToMessage: vi.fn(async () => {}),
  editMessage: vi.fn(async () => {}),
  pinMessage: vi.fn(async () => {}),
  deleteMessage: vi.fn(async () => {}),
  markMessageRead: vi.fn(async () => {}),
}));

// Mock useCurrentTeamMember — returns a stable team member
vi.mock("@/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({
    data: { id: "tm-1", organization_id: "org-a", user_id: "u-1" },
  }),
}));

import {
  useReactMessage,
  useEditMessage,
  usePinMessage,
  useDeleteMessage,
  useMarkMessageRead,
  isFeatureUnavailable,
} from "@/hooks/useMessageActions";
import {
  reactToMessage,
  editMessage,
  pinMessage,
  deleteMessage,
  markMessageRead,
} from "@/lib/whatsappApi";

import { MessageMetaBadges, DeletedPlaceholder } from "@/components/chat/actions/MessageMetaBadges";

// ─── helpers ────────────────────────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── hooks ──────────────────────────────────────────────────

describe("useReactMessage", () => {
  it("calls reactToMessage with correct args", async () => {
    const { result } = renderHook(() => useReactMessage(), { wrapper });
    result.current.mutate({
      instanceId: "inst-1",
      messageId: "msg-1",
      number: "5511999999999",
      emoji: "❤️",
    });
    await waitFor(() => expect(reactToMessage).toHaveBeenCalledOnce());
    expect(reactToMessage).toHaveBeenCalledWith("inst-1", "msg-1", "5511999999999", "❤️");
  });
});

describe("useEditMessage", () => {
  it("calls editMessage with new text", async () => {
    const { result } = renderHook(() => useEditMessage(), { wrapper });
    result.current.mutate({
      instanceId: "inst-1",
      messageId: "msg-1",
      number: "5511999999999",
      text: "corrected",
    });
    await waitFor(() => expect(editMessage).toHaveBeenCalledOnce());
    expect(editMessage).toHaveBeenCalledWith("inst-1", "msg-1", "5511999999999", "corrected");
  });
});

describe("usePinMessage / useDeleteMessage / useMarkMessageRead", () => {
  const args = {
    instanceId: "inst-1",
    messageId: "msg-1",
    number: "5511999999999",
  };

  it("pinMessage invoked", async () => {
    const { result } = renderHook(() => usePinMessage(), { wrapper });
    result.current.mutate(args);
    await waitFor(() => expect(pinMessage).toHaveBeenCalledOnce());
  });

  it("deleteMessage invoked", async () => {
    const { result } = renderHook(() => useDeleteMessage(), { wrapper });
    result.current.mutate(args);
    await waitFor(() => expect(deleteMessage).toHaveBeenCalledOnce());
  });

  it("markMessageRead invoked", async () => {
    const { result } = renderHook(() => useMarkMessageRead(), { wrapper });
    result.current.mutate(args);
    await waitFor(() => expect(markMessageRead).toHaveBeenCalledOnce());
  });
});

// ─── isFeatureUnavailable ──────────────────────────────────

describe("isFeatureUnavailable", () => {
  it("detects NotSupportedError message", () => {
    expect(isFeatureUnavailable(new Error("evolution does not support sendMenu"))).toBe(true);
  });
  it("detects NotSupportedError name token", () => {
    expect(isFeatureUnavailable(new Error("NotSupportedError: react"))).toBe(true);
  });
  it("detects factory fallback message", () => {
    expect(isFeatureUnavailable(new Error('only "uazapi" is supported'))).toBe(true);
  });
  it("returns false for generic errors", () => {
    expect(isFeatureUnavailable(new Error("Network error"))).toBe(false);
  });
  it("returns false for null/undefined", () => {
    expect(isFeatureUnavailable(null)).toBe(false);
    expect(isFeatureUnavailable(undefined)).toBe(false);
  });
});

// ─── MessageMetaBadges ─────────────────────────────────────

describe("MessageMetaBadges", () => {
  it("renders nothing when no metadata", () => {
    const { container } = render(<MessageMetaBadges />);
    expect(container.firstChild).toBeNull();
  });

  it("renders edited badge", () => {
    render(<MessageMetaBadges edited />);
    expect(screen.getByText("editado")).toBeInTheDocument();
  });

  it("renders pinned indicator", () => {
    render(<MessageMetaBadges pinnedAt="2026-04-23T00:00:00Z" />);
    expect(screen.getByLabelText("Mensagem fixada")).toBeInTheDocument();
  });

  it("renders reactions cluster with count", () => {
    render(
      <MessageMetaBadges
        reactions={[
          { emoji: "❤️", from: "them", count: 3 },
          { emoji: "👍", from: "me", count: 1 },
        ]}
      />
    );
    expect(screen.getByText("❤️")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("👍")).toBeInTheDocument();
  });

  it("suppresses badges when deleted_at is set", () => {
    const { container } = render(
      <MessageMetaBadges edited deletedAt="2026-04-23T00:00:00Z" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("ignores non-array reactions", () => {
    const { container } = render(<MessageMetaBadges reactions={"not-array" as unknown} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("DeletedPlaceholder", () => {
  it("renders strikethrough message when deleted", () => {
    render(<DeletedPlaceholder deletedAt="2026-04-23T00:00:00Z" />);
    expect(screen.getByText("Mensagem apagada")).toBeInTheDocument();
  });

  it("renders nothing when not deleted", () => {
    const { container } = render(<DeletedPlaceholder />);
    expect(container.firstChild).toBeNull();
  });
});
