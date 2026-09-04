import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConversationListItem, type ConversationListItemProps } from "./ConversationListItem";
import type { ChatContact } from "@/modules/communication/hooks/chat/types";

function contact(over: Partial<ChatContact> = {}): ChatContact {
  return {
    channel: "whatsapp",
    instance_id: "inst-1",
    phone_number: "5548999000111",
    push_name: "Maria",
    last_message: "oi",
    last_message_time: "2026-07-23T00:00:00Z",
    last_message_direction: "incoming",
    last_message_sent_source: "manual",
    unread_count: 0,
    lead_id: "lead-1",
    lead_name: "Maria Silva",
    conversation_id: "conv-1",
    archived_at: null,
    tags: [],
    is_group: false,
    funnels: [],
    qualification_tier: null,
    ...over,
  };
}

function baseProps(over: Partial<ConversationListItemProps> = {}): ConversationListItemProps {
  return {
    contact: contact(),
    isSelected: false,
    onSelect: vi.fn(),
    activeTab: "active",
    isAdmin: false,
    instanceId: "inst-1",
    organizationId: "org-1",
    allTags: [],
    onArchive: vi.fn(),
    onUnarchive: vi.fn(),
    onDelete: vi.fn(),
    onAddTag: vi.fn(),
    onRemoveTag: vi.fn(),
    ...over,
  };
}

describe("ConversationListItem — pill de etapa (S4)", () => {
  it("mostra o rótulo da etapa quando fornecido", () => {
    render(<ConversationListItem {...baseProps({ stageLabel: "Agendado" })} />);
    expect(screen.getByText("Agendado")).toBeInTheDocument();
  });

  it("não mostra pill quando stageLabel ausente", () => {
    render(<ConversationListItem {...baseProps()} />);
    expect(screen.queryByTitle(/^Etapa:/)).not.toBeInTheDocument();
  });
});
