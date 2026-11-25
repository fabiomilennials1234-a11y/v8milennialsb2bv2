import { describe, expect, it } from "vitest";
import {
  buildDecisions,
  countWrites,
  GROUP_META,
  groupAction,
  initialChoices,
  matchSentence,
  type PreviewRow,
} from "./import-preview";

const rows: PreviewRow[] = [
  { row: 2, group: "novo", name: "Le Bari Café" },
  { row: 15, group: "cliente_erp", name: "Santo Bistrô", match: { origem: "crm", lead_id: "l1", label: "SANTO CAFFE", erp_code: "10088", visible: true } },
  { row: 17, group: "outra_empresa", name: "Leña Torrefação", match: { origem: "arquivo", row: 16, label: "Café Colonial Bela Vista", visible: true } },
  { row: 41, group: "repetido", name: "Empório Canela Restaurante", match: { origem: "arquivo", row: 9, label: "Empório Canela Restaurante", visible: true } },
  { row: 7, group: "sem_telefone", name: "Pimpinella Café e Bistrô" },
];

describe("buildDecisions", () => {
  it("sem escolha, cada grupo vale o padrão: cria novo, pula cliente e outra empresa", () => {
    expect(buildDecisions(rows, initialChoices())).toEqual([
      { row: 2, action: "criar" },
      { row: 15, action: "pular" },
      { row: 17, action: "pular" },
      { row: 41, action: "pular" },
      { row: 7, action: "criar" },
    ]);
  });

  it("linha marcada vira 'criar_compartilhado' só nos grupos que aceitam", () => {
    const choices = { group: { novo: "pular" as const }, shared: new Set([15, 17, 2, 41]) };
    expect(buildDecisions(rows, choices)).toEqual([
      { row: 2, action: "pular" },
      { row: 15, action: "criar_compartilhado" },
      { row: 17, action: "criar_compartilhado" },
      { row: 41, action: "pular" },
      { row: 7, action: "criar" },
    ]);
  });

  it("countWrites conta o que grava", () => {
    expect(countWrites(buildDecisions(rows, initialChoices()))).toBe(2);
  });

  it("o padrão de cada grupo é a primeira ação dele", () => {
    expect(groupAction(initialChoices(), "cliente_erp")).toBe(GROUP_META.cliente_erp.actions[0].value);
    expect(groupAction({ group: { cliente_erp: "vincular" }, shared: new Set() }, "cliente_erp")).toBe("vincular");
  });
});

describe("matchSentence", () => {
  it("diz de quem é o número", () => {
    expect(matchSentence(rows[1])).toBe("Cliente do ERP cód 10088 — SANTO CAFFE");
    expect(matchSentence(rows[2])).toBe("Mesmo número de Café Colonial Bela Vista (linha 16)");
    expect(matchSentence(rows[0])).toBeNull();
  });

  it("não revela cadastro que a pessoa não enxerga", () => {
    expect(matchSentence({ ...rows[1], match: { origem: "crm", label: null, erp_code: null, visible: false } })).toBe(
      "Já cadastrado na empresa",
    );
  });
});
