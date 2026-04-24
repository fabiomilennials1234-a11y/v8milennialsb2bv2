import type { Meta, StoryObj } from "@storybook/react";
import { ChatShell } from "./ChatShell";

// ─── Placeholders visuais ──────────────────────────────────────────────────────

function PanelPlaceholder({ label, color = "bg-muted/30" }: { label: string; color?: string }) {
  return (
    <div className={`flex h-full items-center justify-center ${color}`}>
      <span className="text-sm text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

const meta: Meta<typeof ChatShell> = {
  title: "Chat/Layout/ChatShell",
  component: ChatShell,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    onBack: { action: "onBack" },
  },
  decorators: [
    (Story) => (
      <div className="h-[600px] w-full">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const TresColunas: Story = {
  args: {
    list: <PanelPlaceholder label="Lista de conversas" />,
    view: <PanelPlaceholder label="Chat" color="bg-card/50" />,
    context: <PanelPlaceholder label="Contexto do lead" />,
    selectedPhone: "+5511999991001",
    onBack: () => {},
  },
};

export const SemContexto: Story = {
  args: {
    list: <PanelPlaceholder label="Lista de conversas" />,
    view: <PanelPlaceholder label="Chat" color="bg-card/50" />,
    selectedPhone: "+5511999991001",
    onBack: () => {},
  },
};

export const SemConversaSelecionada: Story = {
  name: "Estado: Nenhuma Conversa",
  args: {
    list: <PanelPlaceholder label="Lista de conversas" />,
    view: <PanelPlaceholder label="Empty state do chat" color="bg-card/50" />,
    context: <PanelPlaceholder label="Contexto do lead" />,
    selectedPhone: null,
    onBack: () => {},
  },
};
