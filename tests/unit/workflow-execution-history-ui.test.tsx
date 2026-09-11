import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workflow: { id: "wf-1", name: "Qualificação guiada" } as Record<string, unknown> | null,
  executions: [] as Array<Record<string, unknown>>,
  steps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/modules/workflows/hooks/useWorkflows", () => ({
  useWorkflow: () => ({ data: state.workflow, isLoading: false }),
  useWorkflowExecutions: () => ({ data: state.executions, isLoading: false }),
  useWorkflowExecutionSteps: () => ({ data: state.steps, isLoading: false }),
  useRetryWorkflowExecution: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/modules/workflows/components/SplitAbAnalytics", () => ({ default: () => null }));
vi.mock("@/modules/platform/components/system-alerts/AlertsBanner", () => ({ AlertsBanner: () => null }));

import AutomacoesExecucoes from "@/modules/workflows/pages/AutomacoesExecucoes";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/automacoes/wf-1/execucoes"]}>
      <Routes>
        <Route path="/automacoes/:id/execucoes" element={<AutomacoesExecucoes />} />
      </Routes>
    </MemoryRouter>,
  );
}

const baseExecution = {
  id: "execution-1",
  workflow_id: "wf-1",
  status: "failed",
  started_at: "2026-09-10T12:00:00Z",
  completed_at: "2026-09-10T12:00:01Z",
  retry_of: null,
  guided_version_id: "version-1",
  version_number: 7,
  version_published_at: "2026-09-10T11:00:00Z",
};

describe("workflow execution history UI", () => {
  beforeEach(() => {
    state.workflow = { id: "wf-1", name: "Qualificação guiada" };
    state.executions = [];
    state.steps = [];
  });

  it("does not render execution data when the workflow belongs to another organization", () => {
    state.workflow = null;
    state.executions = [{ ...baseExecution, data_visible: true, lead_name: "Outro tenant" }];
    renderPage();
    expect(screen.getByText("Workflow não encontrado.")).toBeInTheDocument();
    expect(screen.queryByText("Outro tenant")).not.toBeInTheDocument();
  });

  it("shows useful metadata and a protected state without exposing path actions", () => {
    state.executions = [{ ...baseExecution, data_visible: false, lead_id: null, lead_name: null,
      current_node_id: null, error_code: "protected_error", can_retry: false }];
    renderPage();

    expect(screen.getByText("v7")).toBeInTheDocument();
    expect(screen.getByText("Protegido")).toBeInTheDocument();
    expect(screen.getByText("Detalhe protegido pelas suas permissões atuais")).toBeInTheDocument();
    expect(screen.queryByTitle("Repetir execução")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("v7").closest("tr")!);
    expect(screen.getByRole("status")).toHaveTextContent("Detalhes protegidos");
    expect(screen.queryByRole("button", { name: "Repetir a partir da falha" })).not.toBeInTheDocument();
  });

  it("renders only the safe result returned for an authorized reader", () => {
    state.executions = [{ ...baseExecution, data_visible: true, lead_id: "lead-123456789",
      lead_name: "José", current_node_id: "condition", error_code: "execution_failed", can_retry: true }];
    state.steps = [{ id: "step-1", execution_id: "execution-1", node_id: "condition", node_type: "condition",
      node_label: "Condição", status: "failed", output_data: { matched: true, version_id: "version-1" },
      error_code: "execution_failed", executed_at: "2026-09-10T12:00:00.500Z", data_visible: true }];
    renderPage();

    expect(screen.getByText("José")).toBeInTheDocument();
    expect(screen.getByTitle("Repetir execução")).toBeInTheDocument();
    fireEvent.click(screen.getByText("José").closest("tr")!);
    expect(screen.getByText(/"matched": true/)).toBeInTheDocument();
    expect(screen.queryByText(/actual|input_data|secret/)).not.toBeInTheDocument();
  });
});
