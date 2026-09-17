import type { Meta, StoryObj } from "@storybook/react";
import { MetricsWidgetGrid } from "./MetricsWidgetGrid";

const meta = {
  title: "Analytics/Widgets de métricas",
  component: MetricsWidgetGrid,
  parameters: { layout: "padded" },
  args: {
    values: { revenue: 128450, leads: 384, ticket: 8420, proposals: 56, conversion: 18.4, response: 12 },
  },
} satisfies Meta<typeof MetricsWidgetGrid>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Preview: Story = {};
export const Empty: Story = { args: { values: { revenue: 0, leads: 0, ticket: 0, proposals: 0, conversion: 0, response: 0 } } };
