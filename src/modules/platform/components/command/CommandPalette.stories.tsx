import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CommandPaletteContext } from "./CommandPaletteContext";
import { CommandPalette } from "./CommandPalette";

// ─── Wrapper com contexto mock ─────────────────────────────────────────────────

function CommandPaletteDemo({ initialOpen = false }: { initialOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(initialOpen);

  const ctx = {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((v) => !v),
  };

  return (
    <CommandPaletteContext.Provider value={ctx}>
      <div className="flex flex-col items-center gap-4 p-8">
        <Button onClick={() => setIsOpen(true)} variant="outline">
          Abrir palette (⌘K)
        </Button>
        <p className="text-sm text-muted-foreground">
          Estado: {isOpen ? "aberto" : "fechado"}
        </p>
      </div>
      <CommandPalette />
    </CommandPaletteContext.Provider>
  );
}

const meta: Meta = {
  title: "Chat/CommandPalette",
  component: CommandPaletteDemo,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Fechado: Story = {
  render: () => <CommandPaletteDemo initialOpen={false} />,
};

export const Aberto: Story = {
  render: () => <CommandPaletteDemo initialOpen={true} />,
};
