import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CorrigirVendaHistorica } from "@/modules/leads/components/deal-card/CorrigirVendaHistorica";
import { diaDaVenda } from "@/modules/leads/components/deal-card/dia-da-venda";

import { CorrigirVendaHistorica as CorrecaoClassica } from "../../classic/src/modules/leads/components/deal-card/CorrigirVendaHistorica";

function setup(onSalvar = vi.fn().mockResolvedValue(undefined)) {
  const onCancelar = vi.fn();
  render(<Formulario valor={406.68} data="2026-09-30" onSalvar={onSalvar} onCancelar={onCancelar} />);
  return { onSalvar, onCancelar };
}
const salvar = () => screen.getByRole("button", { name: "Salvar correção" });

let Formulario = CorrigirVendaHistorica;

describe.each([["nova",CorrigirVendaHistorica],["clássica",CorrecaoClassica]] as const)("formulário na interface %s", (_, Componente) => {
  beforeEach(() => { Formulario = Componente; });
  it("só habilita salvar com mudança real e motivo", () => {
    setup();
    expect(salvar()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Data da venda"), { target: { value: "2026-10-01" } });
    expect(salvar()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo da correção"), { target: { value: "Faturada em 01/10" } });
    expect(salvar()).toBeEnabled();
  });
  it("envia valor numérico, data e motivo aparado", async () => {
    const { onSalvar, onCancelar } = setup();
    fireEvent.change(screen.getByLabelText("Data da venda"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Valor da venda"), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText("Motivo da correção"), { target: { value: "  Faturada em 01/10 " } });
    fireEvent.click(salvar());
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ valor: 500, data: "2026-10-01", motivo: "Faturada em 01/10" }));
    await waitFor(() => expect(onCancelar).toHaveBeenCalled());
  });
  it("recusa data futura e valor zerado", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Motivo da correção"), { target: { value: "Teste" } });
    fireEvent.change(screen.getByLabelText("Data da venda"), { target: { value: "2999-01-01" } });
    expect(salvar()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Data da venda"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Valor da venda"), { target: { value: "" } });
    expect(salvar()).toBeDisabled();
  });
  it("mostra o erro do servidor e mantém o formulário aberto", async () => {
    const { onCancelar } = setup(vi.fn().mockRejectedValue(new Error("A venda foi alterada por outra pessoa.")));
    fireEvent.change(screen.getByLabelText("Data da venda"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Motivo da correção"), { target: { value: "Teste" } });
    fireEvent.click(salvar());
    expect(await screen.findByRole("alert")).toHaveTextContent("outra pessoa");
    expect(onCancelar).not.toHaveBeenCalled();
  });
});

it("converte a data no fuso da organização", () => {
 expect(diaDaVenda("2026-10-01T01:00:00Z","America/Sao_Paulo")).toBe("2026-09-30");
});
