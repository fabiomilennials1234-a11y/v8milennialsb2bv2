import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ETAPA_DE_PERDA_INDISPONIVEL } from "@/contracts/pipe/perda";

/**
 * F2 — lead criado a partir de conversa social (Instagram) não pode nascer em
 * etapa de perda: a perda sem motivo nasceria aqui. Riofix Pós-vendas
 * `c3a9a203` (lost) e Mustang `78677dbb` (open + is_final_negative).
 */

vi.mock("@/modules/pipelines", () => ({
  useCustomPipelines: () => ({ data: [{ id: "f457", name: "Pós-vendas", is_active: true }] }),
  useCustomPipelineStages: (id?: string) => ({
    data: id
      ? [
          { id: "s-open", name: "Em atendimento", color: "#0f0", stage_role: "open", is_final_negative: false },
          { id: "c3a9", name: "Perda", color: "#f00", stage_role: "lost", is_final_negative: true },
          { id: "7867", name: "Perdido/Desqualificado", color: "#f00", stage_role: "open", is_final_negative: true },
        ]
      : [],
  }),
  usePipelineDisplayConfig: () => ({ data: [] }),
}));
vi.mock("@/modules/identity", () => ({ useCurrentTeamMember: () => ({ data: { id: "tm" } }) }));

import { SocialCreateLeadDialog } from "./SocialCreateLeadDialog";

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => false });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  Reflect.deleteProperty(HTMLElement.prototype, "hasPointerCapture");
});

async function abrirEtapasDoFunilCustom() {
  const onSubmit = vi.fn();
  render(<SocialCreateLeadDialog open onOpenChange={vi.fn()} suggestedName="Fulano" onSubmit={onSubmit} />);
  fireEvent.keyDown(screen.getAllByRole("combobox")[0], { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: /Pós-vendas/ }));
  const combos = screen.getAllByRole("combobox");
  fireEvent.keyDown(combos[combos.length - 1], { key: "ArrowDown" });
  return { onSubmit };
}

describe("SocialCreateLeadDialog — etapa de perda indisponível", () => {
  it("lost e flag legada desabilitadas com o porquê; aberta habilitada", async () => {
    await abrirEtapasDoFunilCustom();
    for (const nome of ["Perda", "Perdido/Desqualificado"]) {
      const op = await screen.findByRole("option", { name: nome });
      expect(op).toHaveAttribute("aria-disabled", "true");
      expect(op).toHaveAttribute("title", ETAPA_DE_PERDA_INDISPONIVEL);
    }
    expect(screen.getByRole("option", { name: "Em atendimento" })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("clicar na perda não seleciona e criar segue travado; nada é enviado", async () => {
    const { onSubmit } = await abrirEtapasDoFunilCustom();
    fireEvent.click(await screen.findByRole("option", { name: "Perda" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    const criar = screen.getByRole("button", { name: /criar/i });
    expect(criar).toBeDisabled();
    fireEvent.click(criar);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("etapa aberta cria normalmente", async () => {
    const { onSubmit } = await abrirEtapasDoFunilCustom();
    fireEvent.click(await screen.findByRole("option", { name: "Em atendimento" }));
    fireEvent.click(screen.getByRole("button", { name: /criar/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ destination: "custom", customStageId: "s-open" }));
  });
});
