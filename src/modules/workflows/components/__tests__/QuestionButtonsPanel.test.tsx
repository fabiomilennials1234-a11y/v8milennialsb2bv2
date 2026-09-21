import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WorkflowUiSession } from "../../../../../tests/helpers/workflow-ui-session";
import { QuestionButtonsPanel } from "../sidebar-panels/QuestionButtonsPanel";
import type { QuestionButtonsNodeData } from "@/types/workflow";
import { ReactFlowProvider } from "@xyflow/react";
import { QuestionButtonsNode } from "../nodes/QuestionButtonsNode";

function canvasProps(data: QuestionButtonsNodeData): React.ComponentProps<typeof QuestionButtonsNode> {
  return {
    id: "question", type: "question_buttons", data, selected: false,
    dragging: false, zIndex: 0, selectable: true, deletable: true, draggable: true,
    isConnectable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
  };
}

function Editor() {
  const [data, setData] = useState<QuestionButtonsNodeData>({
    type: "question_buttons", text: "Qual caminho?", timeoutHours: 24,
    buttons: [{ id: "sales", label: "Vendas" }],
  });
  return <WorkflowUiSession><QuestionButtonsPanel data={data} onUpdate={(updates) => setData({ ...data, ...updates })} /></WorkflowUiSession>;
}

describe("Pergunta com botões — configuração", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("permite escolher apenas instância Uazapi disponível na organização", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").pop();
      let rows: unknown[] = [];
      if (table === "team_members") rows = [{ id: "member", user_id: "user", role: "admin", organization_id: "org", is_active: true }];
      if (table === "whatsapp_instances") {
        expect(url.searchParams.get("organization_id")).toBe("eq.org");
        rows = [{ id: "instance", instance_name: "TorqueSDR", provider: "uazapi", status: "connected" }, { id: "meta", instance_name: "Canal Meta", provider: "notificame", status: "connected" }];
      }
      const headers = new Headers(init?.headers);
      return new Response(JSON.stringify(headers.get("accept")?.includes("vnd.pgrst.object") ? (rows[0] ?? null) : rows), { status: 200, headers: { "content-type": "application/json" } });
    }));
    function InstanceEditor() {
      const [data, setData] = useState<QuestionButtonsNodeData>({ type: "question_buttons", text: "Escolha", buttons: [{ id: "a", label: "Vendas" }], timeoutHours: 24 });
      return <QuestionButtonsPanel data={data} onUpdate={updates => setData({ ...data, ...updates })} />;
    }
    render(<WorkflowUiSession userId="user"><InstanceEditor /></WorkflowUiSession>);
    const select = await screen.findByRole("combobox", { name: "Instância WhatsApp" });
    fireEvent.keyDown(select, { key: "Enter" });
    const instanceOption = await screen.findByRole("option", { name: "TorqueSDR" });
    expect(screen.queryByRole("option", { name: "Canal Meta" })).not.toBeInTheDocument();
    fireEvent.click(instanceOption);
    expect(select).toHaveTextContent("TorqueSDR");
  });
  it("mostra saídas distintas e preserva conexão da opção após renomear e reordenar", () => {
    const data: QuestionButtonsNodeData = { type: "question_buttons", text: "Escolha", timeoutHours: 24, buttons: [{ id: "sales", label: "Vendas" }, { id: "help", label: "Suporte" }] };
    const props = canvasProps(data);
    const { container, rerender } = render(<ReactFlowProvider><QuestionButtonsNode {...props} /></ReactFlowProvider>);
    expect(screen.getByText("Outra resposta")).toBeInTheDocument();
    expect(screen.getByText("Sem resposta")).toBeInTheDocument();
    expect(screen.getByText("Falha no envio")).toBeInTheDocument();
    rerender(<ReactFlowProvider><QuestionButtonsNode {...props} data={{ ...data, buttons: [{ id: "help", label: "Ajuda" }, { id: "sales", label: "Comercial" }] }} /></ReactFlowProvider>);
    expect(container.querySelector('[data-handleid="button:sales"]')?.parentElement).toHaveTextContent("Comercial");
    expect(container.querySelector('[data-handleid="button:help"]')?.parentElement).toHaveTextContent("Ajuda");
  });
  it("mostra no canvas qual configuração impede ativação", () => {
    const props = canvasProps({ type: "question_buttons", text: "Escolha", buttons: [], timeoutHours: 24, __configIssue: "Falta: destino da saída Sem resposta" });
    render(<ReactFlowProvider><QuestionButtonsNode {...props} /></ReactFlowProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("destino da saída Sem resposta");
  });
  it("adiciona até três opções e permite reordenar e remover", () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar botão" }));
    fireEvent.change(screen.getByLabelText("Botão 2"), { target: { value: "Suporte" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar botão" }));
    expect(screen.getByRole("button", { name: "Adicionar botão" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Mover Suporte para cima" }));
    expect(screen.getByLabelText("Botão 1")).toHaveValue("Suporte");
    fireEvent.click(screen.getByRole("button", { name: "Remover Vendas" }));
    expect(screen.getByRole("button", { name: "Adicionar botão" })).toBeEnabled();
    expect(screen.getByText(/conexão dessa opção será removida/i)).toBeInTheDocument();
  });
  it("aponta configuração inválida e aceita prazo fracionário", () => {
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Botão 1"), { target: { value: "A|B" } });
    expect(screen.getByRole("alert")).toHaveTextContent("botões sem separadores reservados");
    fireEvent.change(screen.getByLabelText("Botão 1"), { target: { value: "Vendas" } });
    fireEvent.change(screen.getByLabelText("Prazo de resposta (horas)"), { target: { value: "0.5" } });
    expect(screen.getByLabelText("Prazo de resposta (horas)")).toBeValid();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("permite editar pergunta, opção e prazo pelo painel", () => {
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Como podemos ajudar?" } });
    fireEvent.change(screen.getByLabelText("Botão 1"), { target: { value: "Comercial" } });
    fireEvent.change(screen.getByLabelText("Prazo de resposta (horas)"), { target: { value: "12" } });
    expect(screen.getByLabelText("Mensagem")).toHaveValue("Como podemos ajudar?");
    expect(screen.getByLabelText("Botão 1")).toHaveValue("Comercial");
    expect(screen.getByLabelText("Prazo de resposta (horas)")).toHaveValue(12);
  });
});
