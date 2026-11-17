import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BlocoCadastros } from "../CadastrosDoNumero";
import {
  deveMostrarFaixa,
  ordenarCadastros,
  type CadastroNaConversa,
} from "@/modules/communication/hooks/chat/useCadastrosNaConversa";

const cadastro = (over: Partial<CadastroNaConversa>): CadastroNaConversa => ({
  id: "l1",
  name: "Cliente",
  company: null,
  erp_code: null,
  negociosAbertos: [],
  ...over,
});

const montar = (cadastros: CadastroNaConversa[], leadIdDaConversa: string | null = null, abrir = true) => {
  const r = render(
    <MemoryRouter>
      <BlocoCadastros cadastros={cadastros} leadIdDaConversa={leadIdDaConversa} />
    </MemoryRouter>,
  );
  if (abrir) fireEvent.click(screen.getByRole("button"));
  return r;
};

describe("quando a faixa aparece", () => {
  it("número em 2+ cadastros: sempre, com ou sem lead na conversa", () => {
    expect(deveMostrarFaixa({ cadastros: 2, conversaTemLead: false, isGroup: false })).toBe(true);
    expect(deveMostrarFaixa({ cadastros: 3, conversaTemLead: true, isGroup: false })).toBe(true);
  });

  it("1 cadastro: só quando a conversa está sem lead", () => {
    expect(deveMostrarFaixa({ cadastros: 1, conversaTemLead: false, isGroup: false })).toBe(true);
    expect(deveMostrarFaixa({ cadastros: 1, conversaTemLead: true, isGroup: false })).toBe(false);
  });

  it("número fora do CRM e grupo: nunca", () => {
    expect(deveMostrarFaixa({ cadastros: 0, conversaTemLead: false, isGroup: false })).toBe(false);
    expect(deveMostrarFaixa({ cadastros: 3, conversaTemLead: false, isGroup: true })).toBe(false);
  });
});

describe("ordem dos cadastros", () => {
  it("quem tem negócio aberto vem primeiro, depois por nome", () => {
    const lista = [
      cadastro({ id: "a", name: "Zeta" }),
      cadastro({ id: "b", name: "Alfa" }),
      cadastro({ id: "c", name: "Mu", negociosAbertos: [{ pipeline_name: "Vendas", stage_name: "Proposta" }] }),
    ].sort(ordenarCadastros);
    expect(lista.map((c) => c.id)).toEqual(["c", "b", "a"]);
  });
});

describe("BlocoCadastros", () => {
  it("recolhido: só a contagem, sem a lista", () => {
    montar([cadastro({ id: "a", name: "Alfa" }), cadastro({ id: "b", name: "Beta" })], "a", false);
    const botao = screen.getByRole("button");
    expect(botao).toHaveTextContent("Este número está em 2 cadastros");
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("clicar abre a lista e clicar de novo recolhe", () => {
    montar([cadastro({ id: "a", name: "Alfa" }), cadastro({ id: "b", name: "Beta" })], "a", false);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByRole("link")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("vários cadastros sem vínculo: diz quantos e que a conversa não está ligada", () => {
    montar([
      cadastro({ id: "pj", name: "GSC COMERCIO LTDA", erp_code: "14859", negociosAbertos: [{ pipeline_name: "Vendas", stage_name: "Negociação" }] }),
      cadastro({ id: "pf", name: "Gustavo Silva", erp_code: "15001" }),
    ]);
    const bloco = screen.getByTestId("cadastros-do-numero");
    expect(bloco).toHaveTextContent("Este número está em 2 cadastros");
    expect(bloco).toHaveTextContent("A conversa não está ligada a nenhum deles.");
    expect(within(bloco).getByText("GSC COMERCIO LTDA")).toBeInTheDocument();
    expect(within(bloco).getByText("ERP 14859")).toBeInTheDocument();
    expect(within(bloco).getByText("Vendas · Negociação")).toBeInTheDocument();
    expect(within(bloco).getByText("sem negócio aberto")).toBeInTheDocument();
  });

  it("com vínculo: não avisa que a conversa está solta", () => {
    montar([cadastro({ id: "a", name: "Alfa" }), cadastro({ id: "b", name: "Beta" })], "a", false);
    expect(screen.getByTestId("cadastros-do-numero")).not.toHaveTextContent("não está ligada");
  });

  it("marca o cadastro a que a conversa já está ligada", () => {
    montar([cadastro({ id: "a", name: "Alfa" }), cadastro({ id: "b", name: "Beta" })], "b");
    expect(screen.getByRole("link", { name: /Beta/ })).toHaveTextContent("nesta conversa");
    expect(screen.getByRole("link", { name: /Alfa/ })).not.toHaveTextContent("nesta conversa");
  });

  it("um cadastro só: diz que o número é dele e que a conversa não está ligada", () => {
    montar([cadastro({ id: "a", name: "Alfa" })], null, false);
    expect(screen.getByTestId("cadastros-do-numero")).toHaveTextContent("Este número é de 1 cadastro");
    expect(screen.getByTestId("cadastros-do-numero")).toHaveTextContent("A conversa não está ligada a ele.");
  });

  it("cada cadastro leva à ficha do lead", () => {
    montar([cadastro({ id: "lead-9", name: "Alfa" }), cadastro({ id: "lead-8", name: "Beta" })]);
    expect(screen.getByRole("link", { name: /Alfa/ })).toHaveAttribute("href", "/leads?lead=lead-9");
  });

  it("mais de um negócio aberto: mostra o primeiro e quantos mais", () => {
    montar([
      cadastro({ id: "a", name: "Alfa", negociosAbertos: [{ pipeline_name: "Vendas", stage_name: "Proposta" }, { pipeline_name: "Recompra", stage_name: "Novo" }] }),
      cadastro({ id: "b", name: "Beta" }),
    ]);
    expect(screen.getByText("Vendas · Proposta +1")).toBeInTheDocument();
  });
});
