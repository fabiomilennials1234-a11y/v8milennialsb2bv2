import { describe, expect, it } from "vitest";
import { countDuplicates } from "./import-errors";

describe("countDuplicates", () => {
  it("conta pelo kind quando a edge manda", () => {
    expect(
      countDuplicates([
        { row: 22, reason: "Telefone duplicado neste arquivo (mesmo número da linha 6)", kind: "duplicado" },
        { row: 15, reason: "Já é cliente do ERP — cód 10088, SANTO CAFFE.", kind: "ja_cadastrado" },
        { row: 30, reason: "Linha 30: telefone inválido (123)", kind: "invalido" },
        { row: 31, reason: "Erro ao inserir lead: timeout", kind: "falha" },
      ]),
    ).toBe(2);
  });

  it("edge sem kind: cai no texto, inclusive o motivo novo de cliente do ERP", () => {
    expect(
      countDuplicates([
        { row: 2, reason: "Telefone duplicado neste arquivo" },
        { row: 3, reason: "Lead já existe sem dados novos para atualizar" },
        { row: 4, reason: "Já é cliente do ERP — cód 11711, CANTINHO DA SAÚDE" },
        { row: 5, reason: "Erro inesperado: x" },
      ]),
    ).toBe(3);
  });

  it("kind manda mesmo quando o texto parece duplicata", () => {
    expect(countDuplicates([{ row: 9, reason: "duplicado?", kind: "falha" }])).toBe(0);
  });
});
