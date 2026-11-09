import { describe, expect, it } from "vitest";
import { pastedFileFrom, shouldIgnorePaste, type PasteData } from "./pasted-attachment";

const NOW = new Date(2026, 10, 9, 14, 5, 9); // 2026-11-09 14:05:09 (hora local)

const png = (name = "image.png") => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });

function data(partial: { files?: File[]; text?: string; itemFile?: File | null }): PasteData {
  return {
    files: (partial.files ?? []) as unknown as FileList,
    items: partial.itemFile
      ? ([{ kind: "file", getAsFile: () => partial.itemFile }] as unknown as DataTransferItemList)
      : ([] as unknown as DataTransferItemList),
    getData: (type: string) => (type === "text/plain" ? (partial.text ?? "") : ""),
  };
}

describe("pastedFileFrom", () => {
  it("print de tela (só imagem) vira anexo com nome de captura", () => {
    const file = pastedFileFrom(data({ files: [png()] }), NOW);
    expect(file).not.toBeNull();
    expect(file!.type).toBe("image/png");
    expect(file!.name).toBe("captura-20261109-140509.png");
  });

  it("nome real do arquivo é preservado (copiado do Explorer)", () => {
    const file = pastedFileFrom(data({ files: [new File(["x"], "orcamento.pdf", { type: "application/pdf" })] }), NOW);
    expect(file!.name).toBe("orcamento.pdf");
  });

  it("texto vence: cópia do Excel/Word traz imagem E texto e cola o texto", () => {
    expect(pastedFileFrom(data({ files: [png()], text: "A1\tB1" }), NOW)).toBeNull();
  });

  it("texto só com espaço não conta como texto", () => {
    expect(pastedFileFrom(data({ files: [png()], text: "  \n" }), NOW)).not.toBeNull();
  });

  it("cai para items quando files vem vazio (alguns navegadores)", () => {
    const file = pastedFileFrom(data({ itemFile: png() }), NOW);
    expect(file!.name).toBe("captura-20261109-140509.png");
  });

  it("sem arquivo ou sem clipboard: null, o texto cola normalmente", () => {
    expect(pastedFileFrom(data({ text: "oi" }), NOW)).toBeNull();
    expect(pastedFileFrom(data({}), NOW)).toBeNull();
    expect(pastedFileFrom(null, NOW)).toBeNull();
  });

  it("clipboard que lança não derruba o chat", () => {
    const quebrado: PasteData = {
      files: [] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
      getData: () => {
        throw new Error("blocked");
      },
    };
    expect(() => pastedFileFrom(quebrado, NOW)).not.toThrow();
  });
});

describe("shouldIgnorePaste", () => {
  const root = document.createElement("div");
  const dentroInput = document.createElement("textarea");
  root.appendChild(dentroInput);
  const corpo = document.createElement("div");
  const foraInput = document.createElement("input");
  const foraBotao = document.createElement("button");
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const botaoNoDialog = document.createElement("button");
  dialog.appendChild(botaoNoDialog);
  document.body.append(root, corpo, foraInput, foraBotao, dialog);

  it("campo do próprio composer: trata", () => {
    expect(shouldIgnorePaste(dentroInput, root)).toBe(false);
  });

  it("foco solto na página (lista de mensagens, body): trata, como o WhatsApp Web", () => {
    expect(shouldIgnorePaste(foraBotao, root)).toBe(false);
    expect(shouldIgnorePaste(document.body, root)).toBe(false);
  });

  it("outro campo de texto da página: ignora", () => {
    expect(shouldIgnorePaste(foraInput, root)).toBe(true);
  });

  it("modal aberto por cima: ignora, mesmo sem estar num campo", () => {
    expect(shouldIgnorePaste(botaoNoDialog, root)).toBe(true);
  });

  it("sem alvo ou sem raiz: ignora", () => {
    expect(shouldIgnorePaste(null, root)).toBe(true);
    expect(shouldIgnorePaste(foraBotao, null)).toBe(true);
  });
});
