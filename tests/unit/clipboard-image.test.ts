/**
 * extractPastedImage — o que um Ctrl/⌘+V no compositor vira.
 *
 * Contrato: imagem colada vira UM File pronto para o mesmo fluxo do botão de
 * anexo; texto colado (inclusive o texto+png que Office/Sheets mandam) segue
 * como texto. A validação de formato/tamanho NÃO mora aqui — é do validador de
 * cada compositor, que recusa depois (ex.: image/tiff).
 */
import { describe, it, expect } from "vitest";
import { extractPastedImage, type PastedData } from "@/modules/communication/lib/clipboard-image";

const NOW = new Date(2026, 9, 9, 14, 5, 7); // 09/10/2026 14:05:07, horário local

function png(name = "image.png", type = "image/png"): File {
  return new File(["fake-bytes"], name, { type });
}

function clip({
  items = [] as File[],
  files = [] as File[],
  text = "",
  stringItems = [] as string[],
} = {}): PastedData {
  const itemList = [
    ...stringItems.map((type) => ({ kind: "string", type, getAsFile: () => null })),
    ...items.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
  ];
  return {
    items: itemList as unknown as DataTransferItemList,
    files: files as unknown as FileList,
    getData: (format: string) => (format === "text/plain" ? text : ""),
  };
}

describe("extractPastedImage", () => {
  it("só png → devolve o arquivo", () => {
    const { file, ignored } = extractPastedImage(clip({ items: [png("tela.png")] }), NOW);
    expect(file).not.toBeNull();
    expect(file!.type).toBe("image/png");
    expect(ignored).toBe(0);
  });

  it("png chamado `image.png` (print) ganha nome sintético com data e hora", () => {
    const { file } = extractPastedImage(clip({ items: [png("image.png")] }), NOW);
    expect(file!.name).toBe("print-20261009-140507.png");
    expect(file!.type).toBe("image/png");
  });

  it("png sem nome também ganha nome sintético; jpeg vira .jpg", () => {
    expect(extractPastedImage(clip({ items: [png("")] }), NOW).file!.name).toBe("print-20261009-140507.png");
    expect(
      extractPastedImage(clip({ items: [png("image.jpeg", "image/jpeg")] }), NOW).file!.name,
    ).toBe("print-20261009-140507.jpg");
  });

  it("nome real do arquivo copiado é preservado", () => {
    const { file } = extractPastedImage(clip({ items: [png("orcamento-riofix.png")] }), NOW);
    expect(file!.name).toBe("orcamento-riofix.png");
  });

  it("texto + png (Office/Sheets) → texto ganha, nenhum arquivo", () => {
    const res = extractPastedImage(
      clip({ items: [png()], text: "A1\tB1", stringItems: ["text/plain", "text/html"] }),
      NOW,
    );
    expect(res).toEqual({ file: null, ignored: 0 });
  });

  it("só texto → nenhum arquivo", () => {
    const res = extractPastedImage(clip({ text: "olá", stringItems: ["text/plain"] }), NOW);
    expect(res).toEqual({ file: null, ignored: 0 });
  });

  it("texto só de espaços não bloqueia a imagem", () => {
    const { file } = extractPastedImage(clip({ items: [png()], text: "  \n" }), NOW);
    expect(file).not.toBeNull();
  });

  it("duas imagens → primeira + ignored=1", () => {
    const a = png("a.png");
    const b = png("b.png");
    const { file, ignored } = extractPastedImage(clip({ items: [a, b] }), NOW);
    expect(file!.name).toBe("a.png");
    expect(ignored).toBe(1);
  });

  it("Safari: items vazio, files preenchido → usa files", () => {
    const { file, ignored } = extractPastedImage(clip({ files: [png("foto.png")] }), NOW);
    expect(file!.name).toBe("foto.png");
    expect(ignored).toBe(0);
  });

  it("a mesma imagem em items e files não duplica", () => {
    const f = png("foto.png");
    const { file, ignored } = extractPastedImage(clip({ items: [f], files: [f] }), NOW);
    expect(file!.name).toBe("foto.png");
    expect(ignored).toBe(0);
  });

  it("image/tiff passa (quem recusa é o validador do compositor)", () => {
    const { file } = extractPastedImage(clip({ items: [png("scan.tiff", "image/tiff")] }), NOW);
    expect(file!.type).toBe("image/tiff");
  });

  it("application/pdf é ignorado (colar não é o caminho de documento)", () => {
    const pdf = new File(["%PDF"], "proposta.pdf", { type: "application/pdf" });
    const res = extractPastedImage(clip({ items: [pdf], files: [pdf] }), NOW);
    expect(res).toEqual({ file: null, ignored: 0 });
  });

  it("clipboardData ausente → nada", () => {
    expect(extractPastedImage(null, NOW)).toEqual({ file: null, ignored: 0 });
  });
});
