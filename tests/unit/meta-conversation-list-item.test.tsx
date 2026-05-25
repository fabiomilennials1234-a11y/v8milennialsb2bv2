// tests/unit/meta-conversation-list-item.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MetaConversationListItem } from "@/components/chat-meta/MetaConversationListItem";

const baseConv: any = {
  id: "c1",
  external_username: "@alice",
  external_user_id: "ig_user",
  profile_pic_url: null,
  channel: "instagram",
  last_message_preview: "olá",
  last_message_at: new Date().toISOString(),
  unread_count: 2,
  lead: { id: "l1", name: "Alice Silva", phone: null },
};

describe("MetaConversationListItem", () => {
  it("renders username, preview, unread badge, lead chip", () => {
    render(<MetaConversationListItem conversation={baseConv} selected={false} onClick={() => {}} />);
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("olá")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Alice Silva")).toBeInTheDocument();
  });

  it("fires onClick when clicked", () => {
    const onClick = vi.fn();
    render(<MetaConversationListItem conversation={baseConv} selected={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledWith("c1");
  });

  it("renders fallback when no username", () => {
    render(<MetaConversationListItem conversation={{ ...baseConv, external_username: null }} selected={false} onClick={() => {}} />);
    expect(screen.getByText(/Usuário do/i)).toBeInTheDocument();
  });
});
