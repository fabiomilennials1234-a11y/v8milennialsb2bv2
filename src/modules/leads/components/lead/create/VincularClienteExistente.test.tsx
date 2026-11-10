import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { termoSeguro, type LeadParaVincular } from "../../../hooks/useBuscaLeadsParaVincular";

const h = vi.hoisted(() => ({
  data: [] as LeadParaVincular[],
  isLoading: false,
  termos: [] as string[],
}));

vi.mock("../../../hooks/useBuscaLeadsParaVincular", async (orig) => ({
  ...(await orig<typeof import("../../../hooks/useBuscaLeadsParaVincular")>()),
  useBuscaLeadsParaVincular: (termo: string) => {
    h.termos.push(termo);
    return { data: h.data, isLoading: h.isLoading, isError: false };
  },
}));
// Sem debounce no teste: o termo digitado chega na busca na hora.
vi.mock("@/shared/hooks/useDebounce", () => ({ useDebounce: <T,>(v: T) => v }));

import { VincularClienteExistente } from "./VincularClienteExistente";

const CLIENTE: LeadParaVincular = { id: "lead-erp", name: "GSC COMERCIO DE ALIMENTOS", company: "SABOR & CIA", phone: "4933334444", erp_code: "14859" };

beforeEach(() => {
  h.data = [];
  h.isLoading = false;
  h.termos = [];
});

describe("VincularClienteExistente", () => {
  it("explica o que acontece com o número da conversa", () => {
    render(<VincularClienteExistente phoneNumber="5548922220000" onVincular={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Já é cliente?" })).toBeInTheDocument();
    expect(screen.getByText(/passa a ser um\s+telefone dele/)).toBeInTheDocument();
    expect(screen.getByText(/ou crie um lead novo/i)).toBeInTheDocument();
  });

  it("busca pelo que foi digitado e mostra código do ERP, nome fantasia e telefone", () => {
    h.data = [CLIENTE];
    render(<VincularClienteExistente phoneNumber="5548922220000" onVincular={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar cliente para vincular" }), { target: { value: "14859" } });
    expect(h.termos.at(-1)).toBe("14859");
    expect(screen.getByText("GSC COMERCIO DE ALIMENTOS")).toBeInTheDocument();
    expect(screen.getByText(/ERP 14859 · SABOR & CIA/)).toBeInTheDocument();
  });

  it("Vincular entrega o cliente escolhido ao host", () => {
    h.data = [CLIENTE];
    const onVincular = vi.fn();
    render(<VincularClienteExistente phoneNumber="5548922220000" onVincular={onVincular} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar cliente para vincular" }), { target: { value: "GSC" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular a GSC COMERCIO DE ALIMENTOS" }));
    expect(onVincular).toHaveBeenCalledWith(CLIENTE);
  });

  it("enquanto vincula, os botões travam — sem vínculo em dobro", () => {
    h.data = [CLIENTE, { ...CLIENTE, id: "outro", name: "Outro" }];
    render(<VincularClienteExistente phoneNumber="5548922220000" onVincular={vi.fn()} vinculandoId="lead-erp" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar cliente para vincular" }), { target: { value: "GS" } });
    for (const b of screen.getAllByRole("button", { name: /^Vincular a/ })) expect(b).toBeDisabled();
  });

  it("busca curta não mostra lista", () => {
    render(<VincularClienteExistente phoneNumber="5548922220000" onVincular={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar cliente para vincular" }), { target: { value: "a" } });
    expect(screen.queryByRole("list", { name: "Clientes encontrados" })).not.toBeInTheDocument();
  });

  it("sem resultado diz o que foi buscado", () => {
    render(<VincularClienteExistente phoneNumber="5548922220000" onVincular={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar cliente para vincular" }), { target: { value: "xyz" } });
    expect(screen.getByText("Nenhum cliente com “xyz”.")).toBeInTheDocument();
  });
});

describe("termoSeguro", () => {
  it("tira o que quebra o .or() do PostgREST", () => {
    expect(termoSeguro("Café (Jurerê), 7001")).toBe("Café Jurerê 7001");
    expect(termoSeguro("100%_*")).toBe("100");
  });
});
