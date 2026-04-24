import type { Meta, StoryObj } from "@storybook/react";
import { ChatEmptyState } from "./ChatEmptyState";

const meta: Meta<typeof ChatEmptyState> = {
  title: "Chat/ChatEmptyState",
  component: ChatEmptyState,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  argTypes: {
    onOpenTemplates: { action: "onOpenTemplates" },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    contactName: "João Silva",
    instanceName: "Vendas Principal",
    onOpenTemplates: () => {},
  },
};

export const SemInstancia: Story = {
  args: {
    contactName: "Maria Oliveira",
    onOpenTemplates: () => {},
  },
};
