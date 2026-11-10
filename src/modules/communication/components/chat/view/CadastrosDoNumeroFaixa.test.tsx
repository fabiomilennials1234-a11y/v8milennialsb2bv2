import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FaixaCadastros } from "./CadastrosDoNumeroFaixa";
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

const montar = (cadastros: CadastroNaConversa[], leadIdDaConversa: string | null = null) =>
  render(
    <MemoryRouter>
      <FaixaCadastros cadastros={cadastros} leadIdDaConversa={leadIdDaConversa} />
    </MemoryRouter>,
  );

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

describe("FaixaCadastros", () => {
  it("vários cadastros sem vínculo: diz quantos e que a conversa não está ligada", () => {
    montar([
      cadastro({ id: "pj", name: "GSC COMERCIO LTDA", erp_code: "14859", negociosAbertos: [{ pipeline_name: "Vendas", stage_name: "Negociação" }] }),
      cadastro({ id: "pf", name: "Gustavo Silva", erp_code: "15001" }),
    ]);
    const faixa = screen.getByRole("status");
    expect(faixa).toHaveTextContent("Este número está em 2 cadastros — a conversa não está ligada a nenhum deles.");
    expect(within(faixa).getByText("GSC COMERCIO LTDA")).toBeInTheDocument();
    expect(within(faixa).getByText("ERP 14859")).toBeInTheDocument();
    expect(within(faixa).getByText("Vendas · Negociação")).toBeInTheDocument();
    expect(within(faixa).getByText("sem negócio aberto")).toBeInTheDocument();
  });

  it("marca o cadastro a que a conversa já está ligada", () => {
    montar([cadastro({ id: "a", name: "Alfa" }), cadastro({ id: "b", name: "Beta" })], "b");
    const beta = screen.getByRole("link", { name: /Beta/ });
    expect(beta).toHaveTextContent("nesta conversa");
    expect(screen.getByRole("link", { name: /Alfa/ })).not.toHaveTextContent("nesta conversa");
  });

  it("um cadastro só: explica que o número é dele mas a conversa não está ligada", () => {
    montar([cadastro({ id: "a", name: "Alfa" })]);
    expect(screen.getByRole("status")).toHaveTextContent("Este número é do cadastro abaixo, mas a conversa não está ligada a ele.");
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
