import type { Meta, StoryObj } from "@storybook/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { TakeoverControls } from "./TakeoverControls";
import type { AiTakeoverState } from "@/lib/chat-types";

// ─── Decorator: injeta estado FSM via QueryClient (sem Supabase) ───────────────

function withTakeoverState(state: AiTakeoverState) {
  return function TakeoverStateDecorator(Story: React.ComponentType) {
    const qc = useQueryClient();
    useEffect(() => {
      qc.setQueryData(["takeover", "conv-story-001"], {
        ai_state: state,
        ai_state_resume_mode: null,
        ai_state_updated_at: new Date().toISOString(),
      });
    }, [qc]);
    return <Story />;
  };
}

const meta: Meta<typeof TakeoverControls> = {
  title: "Chat/Takeover/TakeoverControls",
  component: TakeoverControls,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  argTypes: {
    onOpenTimeline: { action: "onOpenTimeline" },
  },
  args: {
    conversationId: "conv-story-001",
    onOpenTimeline: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const AiAtiva: Story = {
  decorators: [withTakeoverState("AI_ACTIVE")],
};

export const AiPausada: Story = {
  decorators: [withTakeoverState("AI_PAUSED_MANUAL")],
};

export const AguardandoHumano: Story = {
  decorators: [withTakeoverState("WAITING_HUMAN")],
};

export const HumanoAtivo: Story = {
  decorators: [withTakeoverState("HUMAN_ACTIVE")],
};

export const RetomandoAi: Story = {
  decorators: [withTakeoverState("HANDOFF_BACK")],
};

export const SemConversa: Story = {
  args: {
    conversationId: null,
  },
};
