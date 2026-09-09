import { render, screen, fireEvent } from "@testing-library/react";
import { StageRail } from "../StageRail";

const basePipe = {
  kind: "system" as const,
  recordId: "entry-1",
  pipeRef: "whatsapp",
  shortLabel: "Qualif",
  color: "#6366f1",
  stages: [
    { key: "novo_lead", label: "Novo" },
    { key: "abordado", label: "Abordado" },
    { key: "respondeu", label: "Respondeu" },
  ],
  currentKey: "abordado",
};

describe("StageRail", () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("marks current stage with aria-selected and others as unselected", () => {
    render(
      <StageRail
        pipe={basePipe}
        pendingStageKey={null}
        recentlyMovedStageKey={null}
        onMove={vi.fn()}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
    expect(tabs[2]).toHaveAttribute("aria-selected", "false");
  });

  it("calls onMove with a system payload when clicking a non-current segment", () => {
    const onMove = vi.fn();
    render(
      <StageRail
        pipe={basePipe}
        pendingStageKey={null}
        recentlyMovedStageKey={null}
        onMove={onMove}
      />,
    );
    fireEvent.click(screen.getByText("Respondeu"));
    expect(onMove).toHaveBeenCalledWith({
      kind: "system",
      pipeId: "entry-1",
      stageKey: "respondeu",
      stageLabel: "Respondeu",
    });
  });

  it("does not call onMove when clicking the current segment", () => {
    const onMove = vi.fn();
    render(
      <StageRail
        pipe={basePipe}
        pendingStageKey={null}
        recentlyMovedStageKey={null}
        onMove={onMove}
      />,
    );
    fireEvent.click(screen.getByText("Abordado"));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("emits a custom payload for kind=custom pipes", () => {
    const onMove = vi.fn();
    render(
      <StageRail
        pipe={{
          kind: "custom",
          recordId: "custom-entry-9",
          pipeRef: "pipeline-uuid-1",
          shortLabel: "Onboarding",
          color: "#fff",
          stages: [
            { key: "stage-a", label: "Stage A" },
            { key: "stage-b", label: "Stage B" },
          ],
          currentKey: "stage-a",
        }}
        pendingStageKey={null}
        recentlyMovedStageKey={null}
        onMove={onMove}
      />,
    );
    fireEvent.click(screen.getByText("Stage B"));
    expect(onMove).toHaveBeenCalledWith({
      kind: "custom",
      entryId: "custom-entry-9",
      stageId: "stage-b",
      stageLabel: "Stage B",
    });
  });

  it("renders all segments disabled when disabled=true", () => {
    render(
      <StageRail
        pipe={basePipe}
        pendingStageKey={null}
        recentlyMovedStageKey={null}
        disabled
        disabledReason="Sem permissão"
        onMove={vi.fn()}
      />,
    );
    for (const t of screen.getAllByRole("tab")) {
      expect(t).toBeDisabled();
    }
  });
});
