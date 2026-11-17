import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ResumoCadastros } from "./CadastrosDoNumeroResumo";
import type { CadastroNaConversa } from "@/modules/communication/hooks/chat/useCadastrosNaConversa";

const cadastro = (over: Partial<CadastroNaConversa>): CadastroNaConversa => ({
  id: "l1",
  name: "Cliente",
  company: null,
  erp_code: null,
  negociosAbertos: [],
  ...over,
});

const montar = () =>
  render(
    <MemoryRouter>
      <ResumoCadastros
        cadastros={[cadastro({ id: "a", name: "Alfa", erp_code: "14535" }), cadastro({ id: "b", name: "Beta" })]}
        leadIdDaConversa="b"
      />
    </MemoryRouter>,
  );

describe("ResumoCadastros", () => {
  it("recolhido: só a contagem, sem a lista", () => {
    montar();
    const botao = screen.getByRole("button");
    expect(botao).toHaveTextContent("Este número está em 2 cadastros");
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("clicar abre a lista, sem repetir o título, e clicar de novo recolhe", () => {
    montar();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByText("ERP 14535")).toBeInTheDocument();
    expect(screen.getAllByText(/Este número está em/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("marca o cadastro da conversa", () => {
    montar();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("link", { name: /Beta/ })).toHaveTextContent("nesta conversa");
    expect(screen.getByRole("link", { name: /Alfa/ })).not.toHaveTextContent("nesta conversa");
  });
});
