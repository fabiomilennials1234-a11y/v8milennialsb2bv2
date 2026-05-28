import type { Meta, StoryObj } from "@storybook/react";
import { AddCustomFieldPopover } from "./AddCustomFieldPopover";

const meta: Meta<typeof AddCustomFieldPopover> = {
  title: "Lead/AddCustomFieldPopover",
  component: AddCustomFieldPopover,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
