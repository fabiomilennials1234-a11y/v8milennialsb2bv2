import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ImportPreviewReview } from "./ImportPreviewReview";
import { initialChoices, type ImportPreview, type PreviewChoices } from "../../lib/import-preview";

const PREVIEW: ImportPreview = {
  rows: [
    { row: 2, group: "novo", name: "Le Bari Café", phone: "5554999316404" },
    {
      row: 15,
      group: "cliente_erp",
      name: "Santo Bistrô",
      phone: "5554981448969",
      match: { origem: "crm", lead_id: "l1", label: "SANTO CAFFE", erp_code: "10088", visible: true },
    },
    {
      row: 17,
      group: "outra_empresa",
      name: "Leña Torrefação",
      phone: "555432861608",
      match: { origem: "arquivo", row: 16, label: "Café Colonial Bela Vista", visible: true },
    },
    {
      row: 22,
      group: "outra_empresa",
      name: "Cafeteria É de Chocolate",
      phone: "5551981340007",
      match: { origem: "arquivo", row: 6, label: "Karmel Café", visible: true },
    },
  ],
  counts: { novo: 1, cliente_erp: 1, ja_lead: 0, repetido: 0, outra_empresa: 2, sem_telefone: 0, invalido: 0 },
};

function setup(choices: PreviewChoices = initialChoices()) {
  const onChange = vi.fn();
  render(<ImportPreviewReview preview={PREVIEW} choices={choices} onChange={onChange} />);
  return { onChange };
}

describe("ImportPreviewReview", () => {
  it("abre primeiro os grupos que pedem decisão, com o motivo de cada linha", () => {
    setup();
    expect(screen.getByText("Já são clientes do ERP")).toBeInTheDocument();
    expect(screen.getByText(/Cliente do ERP cód 10088 — SANTO CAFFE/)).toBeInTheDocument();
    expect(screen.getByText(/Mesmo número de Karmel Café \(linha 6\)/)).toBeInTheDocument();
    // "Novos" fica fechado: só a contagem e o título.
    expect(screen.getByText("Novos")).toBeInTheDocument();
    expect(screen.queryByText("Le Bari Café")).not.toBeInTheDocument();
  });

  it("marcar uma linha pede telefone compartilhado só para ela", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Linha 22: criar com telefone compartilhado" }));
    const next = onChange.mock.calls[0][0] as PreviewChoices;
    expect([...next.shared]).toEqual([22]);
  });

  it("'Marcar todas' marca o grupo inteiro e 'Desmarcar todas' limpa", () => {
    const { onChange } = setup();
    const grupo = screen.getByRole("region", { name: "Telefone de outra empresa" });
    fireEvent.click(within(grupo).getByRole("button", { name: "Marcar todas" }));
    expect([...(onChange.mock.calls[0][0] as PreviewChoices).shared].sort()).toEqual([17, 22]);
  });

  it("abre e fecha um grupo pelo título", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Novos/ }));
    expect(screen.getByText("Le Bari Café")).toBeInTheDocument();
  });
});

