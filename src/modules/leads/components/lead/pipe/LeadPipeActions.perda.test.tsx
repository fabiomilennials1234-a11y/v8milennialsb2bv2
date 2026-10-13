import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LeadPipeActions } from "./LeadPipeActions";
import { ETAPA_DE_PERDA_INDISPONIVEL } from "@/contracts/pipe/perda";
import type { PipelineStatus } from "../../../hooks/useLeadAllPipelines";

/**
 * Q1 — "Adicionar" num funil em que o lead não está não pode nascer em etapa
 * de perda: a entrada surgiria perdida sem motivo.
 */

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => false });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  Reflect.deleteProperty(HTMLElement.prototype, "hasPointerCapture");
});

const custom = {
  type: "custom",
  pipelineId: "pipe-1",
  pipelineName: "Mustang",
  pipelineColor: "#333",
  pipeId: null,
  currentStageId: null,
  currentStageLabel: null,
  stages: [
    { id: "st-aberto", name: "Aberto", color: "#0f0", position: 0, role: "open", isFinalNegative: false },
    { id: "st-mustang", name: "Perdido/Desqualificado", color: "#f00", position: 1, role: "open", isFinalNegative: true },
    { id: "st-lost", name: "Perdido", color: "#f00", position: 2, role: "lost", isFinalNegative: false },
  ],
} as unknown as PipelineStatus;

function montar() {
  const onAddToPipeline = vi.fn().mockResolvedValue(undefined);
  render(
    <LeadPipeActions
      pipelines={[custom]}
      onMoveStage={vi.fn()}
      onRemoveFromPipeline={vi.fn()}
      onAddToPipeline={onAddToPipeline}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Adicionar/ }));
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  return { onAddToPipeline };
}

describe("LeadPipeActions — adicionar sem nascer perdido", () => {
  it("etapas de perda desabilitadas com o porquê; aberta habilitada", async () => {
    montar();
    const flag = await screen.findByRole("option", { name: "Perdido/Desqualificado" });
    expect(flag).toHaveAttribute("aria-disabled", "true");
    expect(flag).toHaveAttribute("title", ETAPA_DE_PERDA_INDISPONIVEL);
    expect(screen.getByRole("option", { name: "Perdido" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: "Aberto" })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("clicar na etapa de perda não oferece o botão de adicionar; nada é chamado", async () => {
    const { onAddToPipeline } = montar();
    fireEvent.click(await screen.findByRole("option", { name: "Perdido" }));
    // Opção desabilitada não fecha a lista: fecha-se à mão para ler a linha.
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /Adicionar/ })).toHaveLength(1); // só o do cabeçalho
    expect(onAddToPipeline).not.toHaveBeenCalled();
  });

  it("etapa aberta adiciona", async () => {
    const { onAddToPipeline } = montar();
    fireEvent.click(await screen.findByRole("option", { name: "Aberto" }));
    const botoes = screen.getAllByRole("button", { name: /Adicionar/ });
    fireEvent.click(botoes[botoes.length - 1]);
    expect(onAddToPipeline).toHaveBeenCalledWith(custom, "st-aberto");
  });
});
