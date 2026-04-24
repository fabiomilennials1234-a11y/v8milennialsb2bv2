import type { Meta, StoryObj } from "@storybook/react";
import { HighlightedText } from "./HighlightedText";

const meta: Meta<typeof HighlightedText> = {
  title: "Chat/Search/HighlightedText",
  component: HighlightedText,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const SemHighlight: Story = {
  args: {
    html: "Esta é uma mensagem de exemplo sem marcação",
    className: "text-sm",
  },
};

export const ComHighlight: Story = {
  args: {
    html: "Esta é uma <mark>mensagem</mark> de exemplo com marcação",
    className: "text-sm",
  },
};

export const MultiplasMarcacoes: Story = {
  args: {
    html: "Olá, <mark>gostaria</mark> de saber mais sobre o <mark>produto</mark> de vocês",
    className: "text-sm",
  },
};

export const HtmlInseguro: Story = {
  name: "HTML Inseguro (sanitizado)",
  args: {
    html: 'Tentativa de <script>alert("xss")</script> injeção com <mark>highlight</mark> seguro',
    className: "text-sm",
  },
};
