import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActivityFeed } from "../ActivityFeed";
import type { TimelineEvent } from "@/modules/leads/hooks/useLeadTimeline";

const timelineMock = vi.fn();
// Mock alvo: caminho usado por ActivityFeed.tsx, normalizado via alias absoluto.
vi.mock("@/modules/leads/hooks/useLeadTimeline", () => ({
  useLeadTimeline: (...args: unknown[]) => timelineMock(...args),
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

const commentsMock = vi.fn(() => ({ data: [], isLoading: false }));
vi.mock("../../../hooks/useLeadComments", () => ({
  useLeadComments: () => commentsMock(),
}));

vi.mock("../../../../leads/TimelineItem", () => ({
  TimelineItem: ({ event }: { event: TimelineEvent }) => (
    <div data-testid={`event-${event.id}`} data-action={event.action}>
      {event.description ?? event.action}
    </div>
  ),
}));

function renderFeed() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ActivityFeed leadId="lead-1" />
    </QueryClientProvider>,
  );
}

function ev(over: Partial<TimelineEvent> & { id: string; created_at: string; action: string }): TimelineEvent {
  return {
    description: over.description ?? null,
    source: over.source ?? "system",
    metadata: over.metadata ?? null,
    entity_type: null,
    entity_id: null,
    created_by: null,
    ...over,
  } as TimelineEvent;
}

const baseTimeline = {
  isLoading: false,
  filters: { source: "all" as const, period: "all" as const, search: "" },
  updateFilters: vi.fn(),
};

beforeEach(() => {
  timelineMock.mockReset();
  commentsMock.mockReset().mockReturnValue({ data: [], isLoading: false });
});

describe("ActivityFeed day grouping (issue #311)", () => {
  it("groups items into a Hoje section when created_at is today", () => {
    const now = new Date().toISOString();
    timelineMock.mockReturnValue({
      ...baseTimeline,
      data: { events: [ev({ id: "e1", created_at: now, action: "stage_changed" })], metrics: {}, hasMore: false, totalFiltered: 1 },
    });
    renderFeed();
    expect(screen.getByText("Hoje")).toBeInTheDocument();
  });

  it("groups items into an Ontem section for yesterday", () => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    timelineMock.mockReturnValue({
      ...baseTimeline,
      data: { events: [ev({ id: "e1", created_at: y.toISOString(), action: "lead_created" })], metrics: {}, hasMore: false, totalFiltered: 1 },
    });
    renderFeed();
    expect(screen.getByText("Ontem")).toBeInTheDocument();
  });

  it("formats older days as DD/MM/YYYY", () => {
    const older = "2025-12-15T10:00:00.000Z";
    timelineMock.mockReturnValue({
      ...baseTimeline,
      data: { events: [ev({ id: "e1", created_at: older, action: "stage_changed" })], metrics: {}, hasMore: false, totalFiltered: 1 },
    });
    renderFeed();
    expect(screen.getByText(/15\/12\/2025/)).toBeInTheDocument();
  });

  it("renders multiple day groups in DESC order", () => {
    const today = new Date().toISOString();
    const y = new Date(); y.setDate(y.getDate() - 1);
    timelineMock.mockReturnValue({
      ...baseTimeline,
      data: {
        events: [
          ev({ id: "e-today", created_at: today, action: "stage_changed" }),
          ev({ id: "e-yest", created_at: y.toISOString(), action: "lead_created" }),
        ],
        metrics: {}, hasMore: false, totalFiltered: 2,
      },
    });
    renderFeed();
    // O componente agrupa pela data LOCAL (`format` da date-fns). Montar a
    // chave com `toISOString()` usaria a data UTC, e o teste falhava das 21h a
    // meia-noite no fuso do Brasil — invisivel no CI, que roda em UTC.
    const localKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const hojeKey = localKey(new Date(today));
    const ontemKey = localKey(y);
    const todayGroup = screen.getByTestId(`activity-day-${hojeKey}`);
    const yGroup = screen.getByTestId(`activity-day-${ontemKey}`);
    expect(within(todayGroup).getByText("Hoje")).toBeInTheDocument();
    expect(within(yGroup).getByText("Ontem")).toBeInTheDocument();
  });

  it("marks inbound message events with inbound=true data attr", () => {
    const now = new Date().toISOString();
    timelineMock.mockReturnValue({
      ...baseTimeline,
      data: {
        events: [
          ev({ id: "e-in", created_at: now, action: "whatsapp_received" }),
          ev({ id: "e-out", created_at: now, action: "whatsapp_sent" }),
        ],
        metrics: {}, hasMore: false, totalFiltered: 2,
      },
    });
    const { container } = renderFeed();
    const inboundWrap = container.querySelector('[data-action="whatsapp_received"]');
    const outboundWrap = container.querySelector('[data-action="whatsapp_sent"]');
    expect(inboundWrap?.getAttribute("data-inbound")).toBe("true");
    expect(outboundWrap?.getAttribute("data-inbound")).toBe("false");
  });
});
