import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SEM_CRITERIOS, parseDivisao, type CriteriosDeContato, type DivisaoDosContatos } from "../lib/tipos";
import { DivisaoDosContatosPainel, fraseDosCriterios } from "./DivisaoDosContatos";

const divisao: DivisaoDosContatos = {
  novos: 120,
  comInstagram: 100,
  comTelefone: 40,
  comEmail: 30,
  combinacao: 120,
  selecionados: 120,
  selecionadosComInstagram: 100,
  selecionadosComTelefone: 40,
  selecionadosComEmail: 30,
};

/** O painel é controlado: este invólucro guarda os critérios como a página faz. A combinação vem do "banco". */
function montar(opcoes: { podeEditar?: boolean; combinacao?: (c: CriteriosDeContato) => number; divisao?: DivisaoDosContatos } = {}) {
  const onSelecionar = vi.fn();
  const base = opcoes.divisao ?? divisao;
  function Pagina() {
    const [criterios, setCriterios] = useState<CriteriosDeContato>(SEM_CRITERIOS);
    const combinacao = opcoes.combinacao ? opcoes.combinacao(criterios) : base.combinacao;
    return (
      <DivisaoDosContatosPainel
        divisao={{ ...base, combinacao }}
        criterios={criterios}
        onCriterios={setCriterios}
        onSelecionar={onSelecionar}
        selecionando={false}
        podeEditar={opcoes.podeEditar ?? true}
      />
    );
  }
  render(<Pagina />);
  return { onSelecionar };
}

describe("DivisaoDosContatosPainel", () => {
  it("mostra quantos contatos novos têm cada tipo", () => {
    montar();
    expect(screen.getByLabelText("Com @").closest("label")).toHaveTextContent("100");
    expect(screen.getByLabelText("Com telefone").closest("label")).toHaveTextContent("40");
    expect(screen.getByLabelText("Com e-mail").closest("label")).toHaveTextContent("30");
    expect(screen.getByText(/contatos novos no total/)).toHaveTextContent("120");
  });

  it("marcar mais de um tipo vale como E e a frase diz o que se exige", async () => {
    const user = userEvent.setup();
    montar({ combinacao: (c) => (c.comInstagram && c.comTelefone ? 25 : c.comInstagram ? 100 : 120) });
    await user.click(screen.getByLabelText("Com @"));
    expect(screen.getByText(/têm/)).toHaveTextContent("100 de 120 têm @");
    await user.click(screen.getByLabelText("Com telefone"));
    expect(screen.getByText(/têm/)).toHaveTextContent("25 de 120 têm @ e telefone");
    await user.click(screen.getByLabelText("Com e-mail"));
    expect(screen.getByText(/têm/)).toHaveTextContent("têm @, telefone e e-mail");
    await user.click(screen.getByLabelText("Com @"));
    expect(screen.getByText(/têm/)).toHaveTextContent("têm telefone e e-mail");
  });

  it('o botão diz quantos serão selecionados e dispara a seleção', async () => {
    const user = userEvent.setup();
    const { onSelecionar } = montar({ combinacao: () => 25 });
    expect(screen.getByRole("button", { name: "Selecionar todos (25)" })).toBeEnabled();
    await user.click(screen.getByLabelText("Com telefone"));
    await user.click(screen.getByRole("button", { name: "Selecionar só estes (25)" }));
    expect(onSelecionar).toHaveBeenCalledTimes(1);
  });

  it("combinação vazia não deixa selecionar", async () => {
    const user = userEvent.setup();
    montar({ combinacao: (c) => (c.comInstagram && c.comEmail ? 0 : 120) });
    await user.click(screen.getByLabelText("Com @"));
    await user.click(screen.getByLabelText("Com e-mail"));
    expect(screen.getByRole("button", { name: "Selecionar só estes (0)" })).toBeDisabled();
  });

  it("tipo que ninguém tem fica desabilitado (a busca de Maps não tem @)", () => {
    montar({ divisao: { ...divisao, comInstagram: 0 } });
    expect(screen.getByLabelText("Com @")).toBeDisabled();
    expect(screen.getByLabelText("Com telefone")).toBeEnabled();
  });

  it("quem só lê (sem permissão de editar) vê a divisão mas não tem o botão", () => {
    montar({ podeEditar: false });
    expect(screen.getByLabelText("Com @")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Selecionar/ })).not.toBeInTheDocument();
  });
});

describe("fraseDosCriterios e parseDivisao", () => {
  it("monta a frase em português", () => {
    expect(fraseDosCriterios(SEM_CRITERIOS)).toBe("");
    expect(fraseDosCriterios({ ...SEM_CRITERIOS, comEmail: true })).toBe("e-mail");
    expect(fraseDosCriterios({ comInstagram: true, comTelefone: true, comEmail: false })).toBe("@ e telefone");
    expect(fraseDosCriterios({ comInstagram: true, comTelefone: true, comEmail: true })).toBe("@, telefone e e-mail");
  });

  it("lê o jsonb do banco sem confiar nele", () => {
    expect(
      parseDivisao({ novos: 5, com_instagram: 3, com_telefone: 4, com_email: 2, combinacao: 1, selecionados: 5, selecionados_com_instagram: 3, selecionados_com_telefone: 4, selecionados_com_email: 2 }),
    ).toEqual({ novos: 5, comInstagram: 3, comTelefone: 4, comEmail: 2, combinacao: 1, selecionados: 5, selecionadosComInstagram: 3, selecionadosComTelefone: 4, selecionadosComEmail: 2 });
    expect(parseDivisao(null).novos).toBe(0);
    expect(parseDivisao({ novos: "5", com_email: null }).novos).toBe(0);
    expect(parseDivisao([1, 2]).combinacao).toBe(0);
  });
});
