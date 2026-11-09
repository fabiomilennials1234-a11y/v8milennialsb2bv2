import { describe, expect, it } from "vitest";
import {
  TEMPLATE_MAX_BYTES,
  buildTemplateStoragePath,
  templateDocumentAccept,
  templateDocumentMime,
  templateFileNameFromUrl,
  validateTemplateDocument,
} from "./template-media";

const file = (name: string, size = 1024, type = "") => ({ name, size, type }) as File;

describe("templateDocumentAccept", () => {
  it("base: só PDF e Word", () => {
    const accept = templateDocumentAccept(false);
    expect(accept).toContain(".pdf");
    expect(accept).toContain(".docx");
    expect(accept).not.toContain(".xlsx");
  });

  it("ampliado: planilhas, apresentações, CSV e TXT, por MIME e por extensão", () => {
    const accept = templateDocumentAccept(true);
    for (const token of [".xls", ".xlsx", ".csv", ".ppt", ".pptx", ".txt", ".pdf", ".doc", ".docx"]) {
      expect(accept).toContain(token);
    }
    expect(accept).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });
});

describe("validateTemplateDocument", () => {
  it("aceita xlsx só no modo ampliado", () => {
    expect(validateTemplateDocument(file("Tabela.xlsx"), true)).toBeNull();
    expect(validateTemplateDocument(file("Tabela.xlsx"), false)).toMatch(/formato/i);
  });

  it("aceita PDF e Word nos dois modos", () => {
    for (const extended of [true, false]) {
      expect(validateTemplateDocument(file("a.pdf"), extended)).toBeNull();
      expect(validateTemplateDocument(file("a.docx"), extended)).toBeNull();
    }
  });

  it("decide pela extensão, não pelo MIME (CSV no Windows vem como ms-excel ou vazio)", () => {
    expect(validateTemplateDocument(file("lista.csv", 10, "application/vnd.ms-excel"), true)).toBeNull();
    expect(validateTemplateDocument(file("lista.CSV", 10, ""), true)).toBeNull();
  });

  it("recusa executável e arquivo sem extensão", () => {
    expect(validateTemplateDocument(file("setup.exe"), true)).toMatch(/formato/i);
    expect(validateTemplateDocument(file("setup"), true)).toMatch(/formato/i);
    expect(validateTemplateDocument(file("macro.xlsm"), true)).toMatch(/formato/i);
  });

  it("recusa acima do teto do bucket e arquivo vazio", () => {
    expect(validateTemplateDocument(file("a.pdf", TEMPLATE_MAX_BYTES + 1), true)).toMatch(/50 MB/);
    expect(validateTemplateDocument(file("a.pdf", TEMPLATE_MAX_BYTES), true)).toBeNull();
    expect(validateTemplateDocument(file("a.pdf", 0), true)).toMatch(/vazio/i);
  });
});

describe("templateDocumentMime", () => {
  it("mapeia a extensão para o MIME que o bucket permite", () => {
    expect(templateDocumentMime("x.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(templateDocumentMime("x.XLS")).toBe("application/vnd.ms-excel");
    expect(templateDocumentMime("x.csv")).toBe("text/csv");
    expect(templateDocumentMime("x.txt")).toBe("text/plain");
    expect(templateDocumentMime("x.png")).toBeNull();
  });
});

describe("buildTemplateStoragePath", () => {
  it("guarda o nome original sanitizado sob templates/<uuid>/ (a policy libera o 1º segmento 'templates')", () => {
    const path = buildTemplateStoragePath("Tabela de Preços 2026.xlsx", () => "11111111-2222-3333-4444-555555555555");
    expect(path).toBe("templates/11111111-2222-3333-4444-555555555555/Tabela-de-Precos-2026.xlsx");
  });

  it("tira acento (Storage devolve 'Invalid key') e caracteres de caminho", () => {
    const path = buildTemplateStoragePath("../ação/Orçamento (v2).PDF", () => "u");
    expect(path).toBe("templates/u/Orcamento-v2.pdf");
    expect(path.split("/")).toHaveLength(3);
  });

  it("nome sem base utilizável cai em 'arquivo'", () => {
    expect(buildTemplateStoragePath("!!!.pdf", () => "u")).toBe("templates/u/arquivo.pdf");
  });

  it("limita o tamanho do nome", () => {
    const path = buildTemplateStoragePath(`${"a".repeat(300)}.pdf`, () => "u");
    expect(path.split("/")[2].length).toBeLessThanOrEqual(100);
    expect(path.endsWith(".pdf")).toBe(true);
  });
});

describe("templateFileNameFromUrl", () => {
  const base = "https://x.supabase.co/storage/v1/object/public/media";

  it("recupera o nome original do path novo", () => {
    expect(templateFileNameFromUrl(`${base}/templates/u-u-i-d/Tabela-de-Precos-2026.xlsx`)).toBe("Tabela-de-Precos-2026.xlsx");
  });

  it("template legado (uuid.ext) vira 'documento.ext', nunca um nome sem extensão", () => {
    expect(templateFileNameFromUrl(`${base}/templates/c507515d-80fe-42d1-af41-b576f218ee82.pdf`)).toBe("documento.pdf");
  });

  it("ignora query string e decodifica %20", () => {
    expect(templateFileNameFromUrl(`${base}/templates/u/Minha%20Lista.csv?t=1`)).toBe("Minha Lista.csv");
  });

  it("devolve undefined sem URL ou sem extensão", () => {
    expect(templateFileNameFromUrl(null)).toBeUndefined();
    expect(templateFileNameFromUrl(`${base}/templates/u/semextensao`)).toBeUndefined();
  });
});
