import type { Meta, StoryObj } from "@storybook/react";
import { UnreadDivider } from "./UnreadDivider";

const meta: Meta<typeof UnreadDivider> = {
  title: "Chat/UnreadDivider",
  component: UnreadDivider,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const UmaNaoLida: Story = {
  args: {
    count: 1,
  },
};

export const MultiplasMensagens: Story = {
  args: {
    count: 12,
  },
};
