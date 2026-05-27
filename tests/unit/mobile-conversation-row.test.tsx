import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MobileConversationRow } from "@/modules/communication/components/chat/list/MobileConversationRow";
import type { ChatContact } from "@/modules/communication/hooks/useWhatsAppChat";

const baseContact: ChatContact = {
  phone_number: "5511999999999",
  push_name: "João Silva",
  lead_name: "João Silva",
  lead_id: "lead-1",
  conversation_id: "conv-1",
  last_message: "Olá, tudo bem?",
  last_message_time: new Date().toISOString(),
  last_message_direction: "incoming",
  last_message_sent_source: null,
  unread_count: 0,
  is_group: false,
  tags: [],
  archived_at: null,
};

describe("MobileConversationRow", () => {
  it("renders name, preview, and timestamp", () => {
    const onPress = vi.fn();
    render(
      <MobileConversationRow
        contact={baseContact}
        isSelected={false}
        onPress={onPress}
      />,
    );
    expect(screen.getByText("João Silva")).toBeInTheDocument();
    expect(screen.getByText("Olá, tudo bem?")).toBeInTheDocument();
  });

  it("shows unread badge when count > 0", () => {
    const contact: ChatContact = { ...baseContact, unread_count: 5 };
    render(
      <MobileConversationRow
        contact={contact}
        isSelected={false}
        onPress={vi.fn()}
      />,
    );
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("caps unread badge at 99+", () => {
    const contact: ChatContact = { ...baseContact, unread_count: 150 };
    render(
      <MobileConversationRow
        contact={contact}
        isSelected={false}
        onPress={vi.fn()}
      />,
    );
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("hides unread badge when selected", () => {
    const contact: ChatContact = { ...baseContact, unread_count: 5 };
    render(
      <MobileConversationRow
        contact={contact}
        isSelected={true}
        onPress={vi.fn()}
      />,
    );
    expect(screen.queryByText("5")).not.toBeInTheDocument();
  });

  it("shows stage chip when stageName provided", () => {
    render(
      <MobileConversationRow
        contact={baseContact}
        isSelected={false}
        onPress={vi.fn()}
        stageName="Abordado"
        stageColor="#10b981"
      />,
    );
    expect(screen.getByText("Abordado")).toBeInTheDocument();
  });

  it("does not show AI badge on mobile rows", () => {
    render(
      <MobileConversationRow
        contact={{ ...baseContact, last_message_sent_source: "copilot" }}
        isSelected={false}
        onPress={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("IA ativa")).not.toBeInTheDocument();
  });

  it("fires onPress with phone number", () => {
    const onPress = vi.fn();
    render(
      <MobileConversationRow
        contact={baseContact}
        isSelected={false}
        onPress={onPress}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledWith("5511999999999");
  });

  it("shows 'Você:' prefix for outgoing manual messages", () => {
    const contact: ChatContact = {
      ...baseContact,
      last_message_direction: "outgoing",
      last_message_sent_source: "manual",
    };
    render(
      <MobileConversationRow
        contact={contact}
        isSelected={false}
        onPress={vi.fn()}
      />,
    );
    expect(screen.getByText("Você:")).toBeInTheDocument();
  });

  it("shows 'Sem mensagens' when no last message", () => {
    const contact: ChatContact = { ...baseContact, last_message: null };
    render(
      <MobileConversationRow
        contact={contact}
        isSelected={false}
        onPress={vi.fn()}
      />,
    );
    expect(screen.getByText("Sem mensagens")).toBeInTheDocument();
  });
});
