import type { Meta, StoryObj } from "@storybook/react";
import { ScrollToBottomFab } from "./ScrollToBottomFab";

const meta: Meta<typeof ScrollToBottomFab> = {
  title: "Chat/ScrollToBottomFab",
  component: ScrollToBottomFab,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  argTypes: {
    onClick: { action: "onClick" },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Visible: Story = {
  args: {
    visible: true,
    count: 0,
    onClick: () => {},
  },
};

export const ComMensagensNaoLidas: Story = {
  args: {
    visible: true,
    count: 7,
    onClick: () => {},
  },
};

export const Oculto: Story = {
  args: {
    visible: false,
    count: 0,
    onClick: () => {},
  },
};
