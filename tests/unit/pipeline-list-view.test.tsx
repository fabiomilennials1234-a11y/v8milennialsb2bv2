/**
 * PipelineListView — TDD vertical slices.
 *
 * Componente presentational puro: stage filter chips + lista de leads mobile.
 * 6 ciclos: chips render, chip filter, card content, card click, mover action, empty state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PipelineListView } from "@/modules/pipelines/components/kanban/PipelineListView";

const mockStages = [
  { id: "s1", name: "Novo", stage_key: "novo", color: "#6366f1" },
  { id: "s2", name: "Abordado", stage_key: "abordado", color: "#22c55e" },
  { id: "s3", name: "Respondeu", stage_key: "respondeu", color: "#eab308" },
];

const mockLeads = [
  {
    id: "l1",
    name: "Joao Silva",
    company: "Empresa XYZ",
    phone: "+5511999999999",
    stage_key: "novo",
    created_at: "2026-05-10T00:00:00Z",
  },
  {
    id: "l2",
    name: "Maria Santos",
    company: "ABC Dist",
    phone: "+5515888888888",
    stage_key: "abordado",
    created_at: "2026-05-12T00:00:00Z",
  },
  {
    id: "l3",
    name: "Carlos Souza",
    company: "Tech Corp",
    phone: "+5511777777777",
    stage_key: "novo",
    created_at: "2026-05-14T00:00:00Z",
  },
];

// ---------------------------------------------------------------------------
// Cycle 1 — Stage chips render
// ---------------------------------------------------------------------------
describe("PipelineListView — stage chips", () => {
  it("renders a chip for each stage", () => {
    render(
      <PipelineListView
        stages={mockStages}
        leads={mockLeads}
        onLeadClick={vi.fn()}
        onMoveLeadToStage={vi.fn()}
      />
    );

    for (const stage of mockStages) {
      expect(screen.getByRole("button", { name: new RegExp(stage.name) })).toBeInTheDocument();
    }
  });

  it("first stage is auto-selected by default", () => {
    render(
      <PipelineListView
        stages={mockStages}
        leads={mockLeads}
        onLeadClick={vi.fn()}
        onMoveLeadToStage={vi.fn()}
      />
    );

    const firstChip = screen.getByRole("button", { name: /Novo/ });
    expect(firstChip).toHaveAttribute("aria-pressed", "true");
  });
});

// ---------------------------------------------------------------------------
// Cycle 2 — Chip filter
// ---------------------------------------------------------------------------
describe("PipelineListView — chip filter", () => {
  it("shows only leads of the selected stage", () => {
    render(
      <PipelineListView
        stages={mockStages}
        leads={mockLeads}
        onLeadClick={vi.fn()}
        onMoveLeadToStage={vi.fn()}
      />
    );

    // Default = "novo" — should show Joao + Carlos, not Maria
    expect(screen.getByText("Joao Silva")).toBeInTheDocument();
    expect(screen.getByText("Carlos Souza")).toBeInTheDocument();
    expect(screen.queryByText("Maria Santos")).not.toBeInTheDocument();
  });

  it("clicking another chip filters to that stage", () => {
    render(
      <PipelineListView
        stages={mockStages}
        leads={mockLeads}
        onLeadClick={vi.fn()}
        onMoveLeadToStage={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Abordado/ }));

    expect(screen.getByText("Maria Santos")).toBeInTheDocument();
    expect(screen.queryByText("Joao Silva")).not.toBeInTheDocument();
    expect(screen.queryByText("Carlos Souza")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Cycle 3 — Card content
// ---------------------------------------------------------------------------
describe("PipelineListView — card content", () => {
  it("shows name, company and phone on each card", () => {
    render(
      <PipelineListView
        stages={mockStages}
        leads={mockLeads}
        onLeadClick={vi.fn()}
        onMoveLeadToStage={vi.fn()}
      />
    );

    // Default stage = "novo" (Joao + Carlos)
    expect(screen.getByText("Joao Silva")).toBeInTheDocument();
    expect(screen.getByText("Empresa XYZ")).toBeInTheDocument();
    expect(screen.getByText("+5511999999999")).toBeInTheDocument();

    expect(screen.getByText("Carlos Souza")).toBeInTheDocument();
    expect(screen.getByText("Tech Corp")).toBeInTheDocument();
    expect(screen.getByText("+5511777777777")).toBeInTheDocument();
  });

});

// ---------------------------------------------------------------------------
// Cycle 4 — Card click
// ---------------------------------------------------------------------------
describe("PipelineListView — card click", () => {
  it("calls onLeadClick with the correct leadId", () => {
    const onLeadClick = vi.fn();

    render(
      <PipelineListView
        stages={mockStages}
        leads={mockLeads}
        onLeadClick={onLeadClick}
        onMoveLeadToStage={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Joao Silva"));

    expect(onLeadClick).toHaveBeenCalledWith("l1");
  });
});

// ---------------------------------------------------------------------------
// Cycle 5 — Mover action
// ---------------------------------------------------------------------------
describe("PipelineListView — mover action", () => {
  it("calls onMoveLeadToStage when a stage is selected from move menu", () => {
    const onMove = vi.fn();

    render(
      <PipelineListView
        stages={mockStages}
        leads={mockLeads}
        onLeadClick={vi.fn()}
        onMoveLeadToStage={onMove}
      />
    );

    // Find the first "Mover" button
    const moveButtons = screen.getAllByRole("button", { name: /Mover/i });
    fireEvent.click(moveButtons[0]);

    // Should show options for stages other than current ("novo")
    // Click "Abordado"
    const abordadoOption = screen.getByRole("menuitem", { name: /Abordado/i });
    fireEvent.click(abordadoOption);

    expect(onMove).toHaveBeenCalledWith("l1", "abordado");
  });
});

// ---------------------------------------------------------------------------
// Cycle 6 — Empty state
// ---------------------------------------------------------------------------
describe("PipelineListView — empty state", () => {
  it("shows empty state when filtered stage has no leads", () => {
    render(
      <PipelineListView
        stages={mockStages}
        leads={mockLeads}
        onLeadClick={vi.fn()}
        onMoveLeadToStage={vi.fn()}
      />
    );

    // "Respondeu" has no leads
    fireEvent.click(screen.getByRole("button", { name: /Respondeu/ }));

    expect(screen.getByText(/Nenhum lead nesta etapa/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Bonus — Loading state
// ---------------------------------------------------------------------------
describe("PipelineListView — loading", () => {
  it("renders skeleton when isLoading is true", () => {
    render(
      <PipelineListView
        stages={mockStages}
        leads={[]}
        onLeadClick={vi.fn()}
        onMoveLeadToStage={vi.fn()}
        isLoading
      />
    );

    expect(screen.getAllByTestId("skeleton-card").length).toBeGreaterThanOrEqual(3);
  });
});
