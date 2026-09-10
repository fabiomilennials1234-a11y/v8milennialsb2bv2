import { render, screen } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { expect, it } from "vitest";
import { WaitBusinessWindowNode } from "./WaitBusinessWindowNode";

const window = { id: "morning", name: "Manhã", days: ["mon"], start: "08:00", end: "12:00" };
function node(actions: string[], warning?: string) {
  const props = { id: "bw", data: { windows: actions.map((action, i) => ({ ...window, id: `${i}`, action })), __configIssue: warning } } as NodeProps;
  return render(<ReactFlowProvider><WaitBusinessWindowNode {...props} /></ReactFlowProvider>);
}

it("mostra somente a saída nomeada quando não há janela padrão", () => {
  const { container } = node(["  route:morning  "]);
  expect(screen.getByLabelText("Saída Manhã")).toHaveAttribute("data-handleid", "morning");
  expect(container.querySelectorAll(".source")).toHaveLength(1);
});
it("mostra saída padrão e nomeada em um nó misto", () => {
  const { container } = node(["pass", "route:morning"]);
  expect(screen.getByLabelText("Saída padrão")).toBeInTheDocument();
  expect(container.querySelectorAll(".source")).toHaveLength(2);
});
it("não oferece saída para um bloqueio legado", () => {
  const { container } = node(["hold_until:Comercial"]);
  expect(container.querySelectorAll(".source")).toHaveLength(0);
});
it("mostra a pendência de ativação no próprio nó", () => {
  node(["pass"], "Falta: dias válidos");
  expect(screen.getByText("Falta: dias válidos")).toBeInTheDocument();
});
