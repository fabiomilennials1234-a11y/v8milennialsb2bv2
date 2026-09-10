import { useState } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaitBusinessWindowPanel } from "./WaitBusinessWindowPanel";
import type { WaitBusinessWindowNodeData } from "@/types/workflow";

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const initialData: WaitBusinessWindowNodeData = {
    type: "wait_business_window", label: "Janela Comercial", timezone: "America/Sao_Paulo",
    windows: [{ id: "morning", name: "Manhã", days: ["mon"], start: "08:00", end: "12:00", action: "pass" }],
};
function Editor({ initial = initialData }: { initial?: WaitBusinessWindowNodeData }) {
  const [data, setData] = useState(initial);
  return <><WaitBusinessWindowPanel data={data} onUpdate={patch => setData(old => ({ ...old, ...patch }))} /><output data-testid="action">{data.windows?.[0].action}</output><output data-testid="config">{JSON.stringify(data)}</output></>;
}

it("mantém a escolha de saída nomeada ao trocar o comportamento da janela", async () => {
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(screen.getAllByRole("combobox")[1]);
  await user.click(screen.getByRole("option", { name: "Seguir pela saída desta janela" }));
  expect(screen.getByTestId("action").textContent).toMatch(/^route:.+/);
});

it("mantém a conexão quando o nome da janela muda", () => {
  render(<Editor initial={{ ...initialData, windows: [{ ...initialData.windows![0], action: "route:existing-key" }] }} />);
  fireEvent.change(screen.getByLabelText("Nome da janela 1"), { target: { value: "Manhã nova" } });
  expect(screen.getByTestId("action")).toHaveTextContent("route:existing-key");
  expect(screen.getByText(/Conecte a saída “Manhã nova”/)).toBeInTheDocument();
});

it("mostra erro quando não há nenhum dia selecionado", async () => {
  render(<Editor />);
  await userEvent.click(screen.getByRole("button", { name: "Seg — Manhã" }));
  expect(screen.getByRole("alert")).toHaveTextContent("dias válidos");
});

it("permite mudar a prioridade sem recriar saídas", async () => {
  render(<Editor initial={{ ...initialData, windows: [initialData.windows![0], { ...initialData.windows![0], id: "afternoon", name: "Tarde", action: "route:keep-key" }] }} />);
  await userEvent.click(screen.getByRole("button", { name: "Subir Tarde" }));
  const saved = JSON.parse(screen.getByTestId("config").textContent!);
  expect(saved.windows.map((w: { name: string }) => w.name)).toEqual(["Tarde", "Manhã"]);
  expect(saved.windows[0].action).toBe("route:keep-key");
});

it("exibe o início legado de 08:00 sem inventar 09:00", () => {
  render(<Editor initial={{ type: "wait_business_window", label: "Legado" }} />);
  expect(screen.getByLabelText("Início — Comercial")).toHaveValue("08:00");
});
