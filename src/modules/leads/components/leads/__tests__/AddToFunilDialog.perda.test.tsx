import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeMockPipeOps } from "../../../pipe-ops/testing";
import { AddToFunilDialog } from "../AddToFunilDialog";
import { ETAPA_DE_PERDA_INDISPONIVEL } from "@/contracts/pipe/perda";

/**
 * Q1 — "Adicionar a funil" não pode criar o negócio JÁ perdido: a perda sem
 * motivo nasceria aqui. Etapa de perda (papel `lost` OU flag legada
 * `is_final_negative`, Mustang/Riofix) aparece desabilitada, com o porquê.
 */

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => false });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  Reflect.deleteProperty(HTMLElement.prototype, "hasPointerCapture");
});

const STAGES = [
  { id: "st-aberto", name: "Aberto", color: "#0f0", stage_role: "open", is_final_negative: false },
  { id: "st-mustang", name: "Perdido/Desqualificado", color: "#f00", stage_role: "open", is_final_negative: true },
  { id: "st-lost", name: "Perdido", color: "#f00", stage_role: "lost", is_final_negative: true },
];

function montar() {
  const mutateAsync = vi.fn().mockResolvedValue({ id: "e-1" });
  const pipeOps = makeMockPipeOps({
    useCustomPipelines: (() => ({ data: [{ id: "pipe-1", name: "Mustang" }] })) as never,
    useCustomPipelineStages: ((id?: string) => ({ data: id ? STAGES : [] })) as never,
    useAddLeadToCustomPipe: (() => ({ mutateAsync, isPending: false })) as never,
  });
  render(<AddToFunilDialog pipeOps={pipeOps} leadId="lead-1" open onOpenChange={vi.fn()} />);
  return { mutateAsync };
}

async function abrir(nome: RegExp) {
  const dialogo = screen.getByRole("dialog");
  const combos = within(dialogo).getAllByRole("combobox");
  const alvo = nome.test("funil") ? combos[0] : combos[1];
  fireEvent.keyDown(alvo, { key: "ArrowDown" });
  return dialogo;
}

describe("AddToFunilDialog — etapa de perda indisponível", () => {
  it("etapas de perda (lost e flag legada) ficam desabilitadas com o porquê; aberta não", async () => {
    montar();
    await abrir(/funil/);
    fireEvent.click(await screen.findByRole("option", { name: "Mustang" }));
    await abrir(/etapa/);

    const perdidoFlag = await screen.findByRole("option", { name: "Perdido/Desqualificado" });
    const perdidoLost = screen.getByRole("option", { name: "Perdido" });
    const aberto = screen.getByRole("option", { name: "Aberto" });

    expect(perdidoFlag).toHaveAttribute("aria-disabled", "true");
    expect(perdidoFlag).toHaveAttribute("title", ETAPA_DE_PERDA_INDISPONIVEL);
    expect(perdidoLost).toHaveAttribute("aria-disabled", "true");
    expect(aberto).not.toHaveAttribute("aria-disabled", "true");
    expect(aberto).not.toHaveAttribute("title");
  });

  it("clicar na etapa de perda não seleciona; 'Adicionar' segue travado e nada é escrito", async () => {
    const { mutateAsync } = montar();
    await abrir(/funil/);
    fireEvent.click(await screen.findByRole("option", { name: "Mustang" }));
    await abrir(/etapa/);
    fireEvent.click(await screen.findByRole("option", { name: "Perdido/Desqualificado" }));
    // Opção desabilitada não fecha a lista: fecha-se à mão para ler o diálogo.
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Perdido/Desqualificado")).not.toBeInTheDocument();

    const adicionar = screen.getByRole("button", { name: "Adicionar" });
    expect(adicionar).toBeDisabled();
    fireEvent.click(adicionar);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("etapa aberta segue adicionando normalmente", async () => {
    const { mutateAsync } = montar();
    await abrir(/funil/);
    fireEvent.click(await screen.findByRole("option", { name: "Mustang" }));
    await abrir(/etapa/);
    fireEvent.click(await screen.findByRole("option", { name: "Aberto" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await vi.waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ pipeline_id: "pipe-1", lead_id: "lead-1", stage_id: "st-aberto" }),
    );
  });
});
