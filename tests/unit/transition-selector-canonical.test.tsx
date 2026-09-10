import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: React.ReactNode;
  }) => (
    <select value={value ?? ""} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => (
    <option value={value}>{typeof children === "string" ? children : value}</option>
  ),
}));

const pipelines = [
  { id: "p-entrada", slug: "whatsapp", name: "seed", label: "Entrada VIP", is_active: true },
  { id: "p-vendas", slug: "propostas", name: "seed", label: "Fechamento Sul", is_active: true },
];
const etapas = [
  { id: "s-negociacao", stageKey: "negociacao", label: "Em negociação", position: 1 },
];

vi.mock("@/modules/pipelines/hooks/model/useFunisDaOrg", () => ({
  useFunisDaOrg: () => ({ data: pipelines, isLoading: false }),
}));
vi.mock("@/modules/pipelines/hooks/model/useEtapasDoFunil", () => ({
  useEtapasDoFunil: () => ({ etapas, isLoading: false }),
}));

import { TransitionSelector } from "@/modules/pipelines/components/shared/TransitionSelector";

describe("TransitionSelector — funis canônicos", () => {
  it("mostra uma lista única com os nomes escolhidos pelo usuário", () => {
    render(
      <TransitionSelector
        targetPipelineId={null}
        targetStageId={null}
        targetPipeType={null}
        targetStageKey={null}
        onChangeTarget={vi.fn()}
      />,
    );

    expect(screen.getByText("Entrada VIP")).toBeInTheDocument();
    expect(screen.getByText("Fechamento Sul")).toBeInTheDocument();
    expect(screen.queryByText(/padr[aã]o|custom/i)).toBeNull();
  });

  it("grava UUID do funil e limpa os aliases antigos", () => {
    const onChangeTarget = vi.fn();
    render(
      <TransitionSelector
        targetPipelineId={null}
        targetStageId={null}
        targetPipeType={null}
        targetStageKey={null}
        onChangeTarget={onChangeTarget}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "p-vendas" } });

    expect(onChangeTarget).toHaveBeenCalledWith({
      targetPipelineId: "p-vendas",
      targetStageId: null,
      targetPipeType: null,
      targetStageKey: null,
    });
  });

  it("lê alias legado, mas converte a próxima etapa para UUID", () => {
    const onChangeTarget = vi.fn();
    render(
      <TransitionSelector
        targetPipelineId={null}
        targetStageId={null}
        targetPipeType="propostas"
        targetStageKey="negociacao"
        onChangeTarget={onChangeTarget}
      />,
    );

    const [pipelineSelect, stageSelect] = screen.getAllByRole("combobox");
    expect(pipelineSelect).toHaveValue("p-vendas");
    expect(stageSelect).toHaveValue("s-negociacao");

    fireEvent.change(stageSelect, { target: { value: "s-negociacao" } });
    expect(onChangeTarget).toHaveBeenCalledWith({
      targetPipelineId: "p-vendas",
      targetStageId: "s-negociacao",
      targetPipeType: null,
      targetStageKey: null,
    });
  });
});
