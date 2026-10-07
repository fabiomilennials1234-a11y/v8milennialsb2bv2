// @vitest-environment node
/**
 * A trava do destino contra os caminhos REAIS do repositório, como função pura:
 * `assertSafeOutDir` só resolve caminho, não toca em disco. Os testes que
 * chamam prepareAssets/extractProd de verdade usam só caixa de areia em tmp.
 */
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLOUDFLARE_DIR, REPO_ROOT, assertSafeOutDir, parseArgs } from "../../../scripts/cloudflare/lib.mjs";

describe("assertSafeOutDir (pura) contra os caminhos reais", () => {
  it("as raízes apontam para o checkout", () => {
    expect(path.basename(CLOUDFLARE_DIR)).toBe("cloudflare");
    expect(path.dirname(CLOUDFLARE_DIR)).toBe(REPO_ROOT);
  });

  it.each([
    ["a raiz do repositório", REPO_ROOT],
    ["`.` relativo ao cwd", "."],
    ["cloudflare/", CLOUDFLARE_DIR],
    ["cloudflare/.", path.join(CLOUDFLARE_DIR, ".")],
    ["cloudflare/src", path.join(CLOUDFLARE_DIR, "src")],
    ["cloudflare/node_modules", path.join(CLOUDFLARE_DIR, "node_modules")],
    ["cloudflare/.assets/../src", `${CLOUDFLARE_DIR}/.assets/../src`],
    ["fora do repositório", path.join(REPO_ROOT, "..")],
    ["a home", os.homedir()],
    ["a raiz do disco", path.parse(REPO_ROOT).root],
  ])("recusa %s", (_name, target) => {
    expect(() => assertSafeOutDir(target)).toThrow(/destino recusado/);
  });

  it.each([".assets", ".prod-dist", ".wrangler/dry"])("aceita cloudflare/%s", (rel) => {
    expect(assertSafeOutDir(path.join(CLOUDFLARE_DIR, rel))).toBe(path.join(CLOUDFLARE_DIR, rel));
  });
});

describe("parseArgs", () => {
  it("lê string, number e boolean; recusa flag desconhecida e flag sem valor", () => {
    expect(parseArgs(["--a", "x", "--n", "3", "--v"], { a: "string", n: "number", v: "boolean" })).toEqual({ a: "x", n: 3, v: true });
    expect(() => parseArgs(["--z", "1"], { a: "string" })).toThrow(/desconhecido/);
    expect(() => parseArgs(["--a"], { a: "string" })).toThrow(/precisa de um valor/);
  });
});
