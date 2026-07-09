import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TimelineItem } from "../TimelineItem";
import type { TimelineEvent } from "../../../hooks/useLeadTimeline";

// Atribuição de autor nos eventos ai_disabled/ai_reactivated:
// - eventos novos (rpc h2_2026-06-11) trazem disabled_by_name no metadata —
//   render direto, sem fetch;
// - eventos antigos só têm o UUID em disabled_by — TimelineItem resolve o nome
//   via team_members (query cacheada por user_id).
// Antes do fix, a timeline mostrava o texto genérico "desativada pelo vendedor".

const maybeSingle = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: () => ({ maybeSingle: () => maybeSingle() }),
        }),
      }),
    }),
  },
}));

function makeEvent(overrides: Partial<TimelineEvent>): TimelineEvent {
  return {
    id: "evt-1",
    action: "ai_disabled",
    description: "IA Copilot desativada pelo vendedor",
    source: "manual",
    metadata: null,
    entity_type: null,
    entity_id: null,
    created_at: "2026-06-11T17:27:33.000Z",
    created_by: null,
    ...overrides,
  };
}

function renderItem(event: TimelineEvent) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TimelineItem event={event} isLast />
    </QueryClientProvider>
  );
}

describe("TimelineItem — atribuição do toggle de IA", () => {
  beforeEach(() => {
    maybeSingle.mockReset();
  });

  it("usa o nome embutido no metadata (evento novo, rpc h2) sem fetch", () => {
    renderItem(
      makeEvent({
        metadata: { disabled_by: "uuid-1", disabled_by_name: "Michele Bertin" },
      })
    );

    expect(screen.getByText("IA Copilot desativada por Michele Bertin")).toBeInTheDocument();
    expect(screen.getByText("IA desativada")).toBeInTheDocument();
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("resolve o nome via team_members para evento antigo (só UUID no metadata)", async () => {
    maybeSingle.mockResolvedValue({ data: { name: "Michele Bertin" }, error: null });

    renderItem(makeEvent({ metadata: { disabled_by: "uuid-1" } }));

    expect(await screen.findByText("IA Copilot desativada por Michele Bertin")).toBeInTheDocument();
  });

  it("mantém a description original quando o autor não resolve", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    renderItem(makeEvent({ metadata: { disabled_by: "uuid-orfao" } }));

    expect(await screen.findByText("IA Copilot desativada pelo vendedor")).toBeInTheDocument();
  });

  it("ai_reactivated usa o verbo correto", () => {
    renderItem(
      makeEvent({
        action: "ai_reactivated",
        description: "IA Copilot reativada pelo vendedor",
        metadata: { reactivated_by: "uuid-1", reactivated_by_name: "Michele Bertin" },
      })
    );

    expect(screen.getByText("IA Copilot reativada por Michele Bertin")).toBeInTheDocument();
    expect(screen.getByText("IA reativada")).toBeInTheDocument();
  });

  it("não altera eventos que não são toggle de IA", () => {
    renderItem(
      makeEvent({
        action: "stage_changed",
        description: 'gabrielgipp04: Etapa alterada para "Ajuda Humana"',
        metadata: {},
      })
    );

    expect(
      screen.getByText('gabrielgipp04: Etapa alterada para "Ajuda Humana"')
    ).toBeInTheDocument();
    expect(maybeSingle).not.toHaveBeenCalled();
  });
});
