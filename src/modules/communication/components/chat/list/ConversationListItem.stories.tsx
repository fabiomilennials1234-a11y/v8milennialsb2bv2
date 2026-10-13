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

const caixaRiofix = { id: "inst-001", nome: "Riofix", kind: "whatsapp" as const };

/** Responsável do lead no lugar do nome da caixa; caixa vai no tooltip. */
export const ComResponsavel: Story = {
  args: {
    caixa: caixaRiofix,
    stageLabel: "Vendido",
    responsavel: { nome: "Ana S.", nomeCompleto: "Ana Paula Souza" },
  },
};

export const SemResponsavel: Story = {
  args: { caixa: caixaRiofix, stageLabel: "Vendido", responsavel: null },
};

/** Várias caixas marcadas: a bolinha ganha a cor da caixa antes do nome. */
export const ResponsavelEmVariasCaixas: Story = {
  args: {
    caixa: caixaRiofix,
    variasCaixas: true,
    stageLabel: "Vendido",
    responsavel: { nome: "Ana S.", nomeCompleto: "Ana Paula Souza" },
    tambemEm: [{ id: "inst-002", nome: "Oficial", kind: "whatsapp" as const }],
  },
};
