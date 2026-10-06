// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetReferences, extractProd } from "../../../scripts/cloudflare/extract-prod.mjs";

describe("assetReferences — o grafo que a extração percorre", () => {
  it("acha os chunks citados no index, nos imports e no __vite__mapDeps", () => {
    const html = '<script type="module" crossorigin src="/assets/index-Cu9B4ZgX.js"></script><link rel="stylesheet" href="/assets/index-DqN2l0aB.css">';
    const chunk = 'import{a as b}from"./vendor-xOkhddJM.js";const m=["assets/Agenda-8kmr9wlJ.js","assets/exceljs.min-BzoLa1-K.js"];new URL("logo-AbCdEf12.png",import.meta.url)';
    expect([...assetReferences(html)].sort()).toEqual(["index-Cu9B4ZgX.js", "index-DqN2l0aB.css"]);
    expect([...assetReferences(chunk)].sort()).toEqual([
      "Agenda-8kmr9wlJ.js",
      "exceljs.min-BzoLa1-K.js",
      "logo-AbCdEf12.png",
      "vendor-xOkhddJM.js",
    ]);
  });

  it("ignora nome sem hash do Vite", () => {
    expect([...assetReferences('import x from "./main.js"; fetch("/sw.js"); "lamejs.min.js"')]).toEqual([]);
  });
});

describe("extractProd — destino (caixa de areia em tmp; nenhum caminho do repositório)", () => {
  let tmp: string;
  let cfRoot: string;
  const SENTINEL = "SENTINELA-nao-apagar";
  const sentinels = () => [path.join(tmp, SENTINEL), path.join(cfRoot, SENTINEL), path.join(cfRoot, "src", SENTINEL)];

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cf-extract-"));
    cfRoot = path.join(tmp, "cf");
    fs.mkdirSync(path.join(cfRoot, "src"), { recursive: true });
    for (const file of sentinels()) fs.writeFileSync(file, SENTINEL);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it.each([
    ["o pai da raiz permitida (o repositório, na vida real)", () => tmp],
    ["a raiz permitida (cloudflare/)", () => cfRoot],
    ["cloudflare/src", () => path.join(cfRoot, "src")],
    ["pasta visível dentro da raiz", () => path.join(cfRoot, "out")],
  ])("recusa %s antes de qualquer rede ou rm -rf", async (_name, target) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(extractProd({ out: target(), allowedRoot: cfRoot, log: () => {} })).rejects.toThrow(/destino recusado/);
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const file of sentinels()) expect(fs.readFileSync(file, "utf8"), file).toBe(SENTINEL);
  });
});
