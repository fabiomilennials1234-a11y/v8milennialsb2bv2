// Runs against classic/src through vitest.classic.config.ts.
// Copy of the V5 case in src/modules/workflows/components/__tests__/QuestionButtonsPanel.test.tsx.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { WorkflowUiSession } from "../helpers/workflow-ui-session";
import { QuestionButtonsPanel } from "@/modules/workflows/components/sidebar-panels/QuestionButtonsPanel";

describe("Pergunta com botões (clássica) — variáveis na mensagem", () => {
  it("oferece variáveis na mensagem e grava a inserida no texto", () => {
    const onUpdate = vi.fn();
    render(<WorkflowUiSession><QuestionButtonsPanel onUpdate={onUpdate}
      data={{ type: "question_buttons", text: "Olá ", timeoutHours: 24, buttons: [{ id: "a", label: "A" }] }} /></WorkflowUiSession>);
    (screen.getByLabelText("Mensagem") as HTMLTextAreaElement).setSelectionRange(4, 4);
    fireEvent.click(screen.getByTitle("Clique para inserir {{primeiro_nome}}"));
    expect(onUpdate).toHaveBeenCalledWith({ text: "Olá {{primeiro_nome}}" });
  });
});
