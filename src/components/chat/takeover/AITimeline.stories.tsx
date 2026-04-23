import type { Meta, StoryObj } from "@storybook/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AITimeline } from "./AITimeline";
import type { AiTimelineEvent } from "@/hooks/chat/useAITimeline";

// ─── Fixtures de eventos ──────────────────────────────────────────────────────

const now = new Date();
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000).toISOString();

const events: AiTimelineEvent[] = [
  {
    id: "evt-001",
    type: "message_sent",
    description: "Olá! Vi que você demonstrou interesse no nosso produto. Posso ajudar?",
    metadata: null,
    created_at: ago(2),
    is_reversible: false,
    reverted: false,
  },
  {
    id: "evt-002",
    type: "stage_moved",
    description: "Lead movido de 'novo_lead' para 'abordado'",
    metadata: { from: "novo_lead", to: "abordado" },
    created_at: ago(5),
    is_reversible: true,
    reverted: false,
  },
  {
    id: "evt-003",
    type: "tag_added",
    description: "Tag 'Ouro' adicionada ao lead",
    metadata: { tag: "Ouro" },
    created_at: ago(8),
    is_reversible: true,
    reverted: false,
  },
  {
    id: "evt-004",
    type: "action_executed",
    description: "Qualificação automática concluída — score 78",
    metadata: { score: 78 },
    created_at: ago(12),
    is_reversible: true,
    reverted: false,
  },
  {
    id: "evt-005",
    type: "handoff_triggered",
    description: "IA pediu intervenção humana — cliente solicitou falar com vendedor",
    metadata: null,
    created_at: ago(20),
    is_reversible: false,
    reverted: false,
  },
  {
    id: "evt-006",
    type: "mass_send_completed",
    description: "Campanha 'Black Friday' enviada — 1 de 1 leads",
    metadata: { campaign: "Black Friday" },
    created_at: ago(60),
    is_reversible: false,
    reverted: false,
  },
  {
    id: "evt-007",
    type: "pix_paid",
    description: "Pagamento Pix confirmado — R$ 1.200,00",
    metadata: { amount: 1200 },
    created_at: ago(90),
    is_reversible: false,
    reverted: false,
  },
];

// ─── Decorator: injeta eventos via QueryClient ─────────────────────────────────

function withTimelineEvents(data: AiTimelineEvent[]) {
  return function TimelineDecorator(Story: React.ComponentType) {
    const qc = useQueryClient();
    useEffect(() => {
      qc.setQueryData(["ai-timeline", "lead-story-001"], data);
    }, [qc]);
    return <Story />;
  };
}

const meta: Meta<typeof AITimeline> = {
  title: "Chat/Takeover/AITimeline",
  component: AITimeline,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    leadId: "lead-story-001",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Vazio: Story = {
  decorators: [withTimelineEvents([])],
};

export const ComEventos: Story = {
  decorators: [withTimelineEvents(events)],
};

export const ApenasMensagens: Story = {
  decorators: [
    withTimelineEvents(events.filter((e) => e.type === "message_sent")),
  ],
};

export const ComReversao: Story = {
  decorators: [
    withTimelineEvents([
      ...events,
      {
        id: "evt-008",
        type: "reverted",
        description: "Stage revertida: abordado → novo_lead",
        metadata: { original_event_id: "evt-002" },
        created_at: ago(1),
        is_reversible: false,
        reverted: false,
      },
    ]),
  ],
};
