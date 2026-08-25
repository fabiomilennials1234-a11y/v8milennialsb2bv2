/**
 * O par de botões de resultado, exercitado como a pessoa usa.
 *
 * Prova as regras do pedido que só aparecem no clique: só um selecionado por
 * vez, dá para trocar depois, e dá para voltar a "sem registro" quando marcou
 * errado — este último é o que quase sempre falta numa implementação de dois
 * botões, porque só existem dois botões e três estados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AgendaOutcomeToggle } from "@/modules/engagement/components/agenda/AgendaOutcomeToggle";

const onChange = vi.fn();

beforeEach(() => onChange.mockClear());

const compareceu = () => screen.getByRole("button", { name: "Compareceu" });
const naoCompareceu = () => screen.getByRole("button", { name: "Não compareceu" });

describe("AgendaOutcomeToggle", () => {
  it("sem resultado: nenhum dos dois marcado, e diz que não conta", () => {
    render(<AgendaOutcomeToggle value={null} onChange={onChange} />);
    expect(compareceu()).toHaveAttribute("aria-pressed", "false");
    expect(naoCompareceu()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/não entra na contagem/i)).toBeInTheDocument();
  });

  it("marca exatamente UM — nunca os dois", () => {
    const { rerender } = render(
      <AgendaOutcomeToggle value="compareceu" onChange={onChange} />,
    );
    expect(compareceu()).toHaveAttribute("aria-pressed", "true");
    expect(naoCompareceu()).toHaveAttribute("aria-pressed", "false");

    rerender(<AgendaOutcomeToggle value="nao_compareceu" onChange={onChange} />);
    expect(compareceu()).toHaveAttribute("aria-pressed", "false");
    expect(naoCompareceu()).toHaveAttribute("aria-pressed", "true");
  });

  it("registrar o resultado do zero", async () => {
    const user = userEvent.setup();
    render(<AgendaOutcomeToggle value={null} onChange={onChange} />);
    await user.click(compareceu());
    expect(onChange).toHaveBeenCalledWith("compareceu");
  });

  it("trocar depois, quando marcou o lado errado", async () => {
    const user = userEvent.setup();
    render(<AgendaOutcomeToggle value="compareceu" onChange={onChange} />);
    await user.click(naoCompareceu());
    expect(onChange).toHaveBeenCalledWith("nao_compareceu");
  });

  it("clicar no que já está marcado DESMARCA — o caminho de volta", async () => {
    const user = userEvent.setup();
    render(<AgendaOutcomeToggle value="compareceu" onChange={onChange} />);
    await user.click(compareceu());
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("enquanto salva, não aceita clique — evita gravação em corrida", async () => {
    const user = userEvent.setup();
    render(<AgendaOutcomeToggle value={null} onChange={onChange} saving />);
    expect(compareceu()).toBeDisabled();
    await user.click(compareceu()).catch(() => {});
    expect(onChange).not.toHaveBeenCalled();
  });

  it("desabilitado não grava nada", async () => {
    const user = userEvent.setup();
    render(<AgendaOutcomeToggle value={null} onChange={onChange} disabled />);
    await user.click(compareceu()).catch(() => {});
    expect(onChange).not.toHaveBeenCalled();
  });

  it("o estado selecionado não depende só de cor", () => {
    // Daltônico e impressão em preto e branco continuam funcionando: cada botão
    // tem rótulo em texto e ícone próprio, e o estado vai em `aria-pressed`.
    render(<AgendaOutcomeToggle value="compareceu" onChange={onChange} />);
    expect(compareceu()).toHaveAccessibleName("Compareceu");
    expect(naoCompareceu()).toHaveAccessibleName("Não compareceu");
  });
});
