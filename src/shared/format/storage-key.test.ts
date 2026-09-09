import { describe, it, expect } from "vitest";
import { sanitizeFileName } from "./storage-key";

describe("sanitizeFileName", () => {
  it("remove acento e espaço — o caso que derrubou o upload do catálogo da Loofting", () => {
    expect(sanitizeFileName("ESSÊNCIA LOOFTING VERÃO I_compressed.pdf")).toBe(
      "essencia_loofting_verao_i_compressed.pdf",
    );
  });

  it("mantém a chave dentro do conjunto seguro do Storage", () => {
    const out = sanitizeFileName("Relatório #2026 (final) — cópia!.PDF");
    expect(out).toMatch(/^[a-z0-9._-]+$/);
    expect(out.endsWith(".pdf")).toBe(true);
  });

  it("preserva a extensão em minúsculas", () => {
    expect(sanitizeFileName("Catálogo.PDF")).toBe("catalogo.pdf");
  });

  it("colapsa separadores repetidos e apara as bordas", () => {
    expect(sanitizeFileName("__a   b__.txt")).toBe("a_b.txt");
  });

  it("não inventa extensão quando não existe", () => {
    expect(sanitizeFileName("arquivo sem extensão")).toBe("arquivo_sem_extensao");
  });

  it("ponto inicial não é extensão", () => {
    expect(sanitizeFileName(".gitignore")).toBe("gitignore");
  });

  it("nome inteiro fora do ASCII vira fallback, nunca chave vazia", () => {
    expect(sanitizeFileName("日本語.pdf")).toBe("arquivo.pdf");
  });

  it("trunca o nome base sem perder a extensão", () => {
    const out = sanitizeFileName(`${"a".repeat(200)}.pdf`);
    expect(out).toBe(`${"a".repeat(80)}.pdf`);
  });
});
