import type { Meta, StoryObj } from "@storybook/react";
import { ConversationListItem } from "./ConversationListItem";
import { mockContact, mockContactArchived, mockContactUnread } from "@/mocks/chat-fixtures";

const sharedActions = {
  onSelect: () => {},
  onArchive: () => {},
  onUnarchive: () => {},
  onDelete: () => {},
  onAddTag: () => {},
  onRemoveTag: () => {},
};

const meta: Meta<typeof ConversationListItem> = {
  title: "Chat/List/ConversationListItem",
  component: ConversationListItem,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  argTypes: {
    onSelect: { action: "onSelect" },
    onArchive: { action: "onArchive" },
    onDelete: { action: "onDelete" },
  },
  args: {
    ...sharedActions,
    contact: mockContact,
    isSelected: false,
    activeTab: "active",
    isAdmin: false,
    instanceId: "inst-001",
    organizationId: "org-001",
    allTags: [
      { id: "tag-001", name: "Ouro", color: "#facc15" },
      { id: "tag-002", name: "Prata", color: "#94a3b8" },
    ],
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Selecionado: Story = {
  args: { isSelected: true },
};

export const ComMensagensNaoLidas: Story = {
  args: {
    contact: mockContactUnread,
    isSelected: false,
  },
};

export const Arquivado: Story = {
  args: {
    contact: mockContactArchived,
    activeTab: "archived",
    isAdmin: true,
  },
};

export const SemLead: Story = {
  args: {
    contact: {
      ...mockContact,
      lead_id: null,
      lead_name: null,
      push_name: null,
      tags: [],
    },
  },
};
