// @vitest-environment node
//
// Ambiente node, e não jsdom: este arquivo importa o `vite.config.ts` de
// verdade para EXECUTAR a regra, em vez de procurar texto nela. O vite arrasta
// o esbuild, que se recusa a carregar sob o TextEncoder do jsdom.
/**
 * O worklet de captura tem que sair do build como ARQUIVO, não como `data:` URI.
 *
 * POR QUE ESTE TESTE EXISTE
 * -------------------------
 * Encontrado ao conferir o `npm run build` durante o conserto do áudio
 * (2026-07-30). O `pcm-capture-processor.js` tem ~3 KB e o
 * `build.assetsInlineLimit` padrão do Vite é 4 KB, então o build de produção o
 * transformava em `data:text/javascript;base64,...` e passava essa URL para
 * `audioWorklet.addModule()`.
 *
 * O carregamento de um módulo de worklet é governado por `script-src`, e a CSP
 * deste projeto é `script-src 'self' 'unsafe-inline' 'unsafe-eval' ...`.
 * `'unsafe-inline'` NÃO libera `data:` — logo o navegador barraria o worklet em
 * produção, a captura nunca subiria e a chamada voltaria a conectar muda.
 *
 * O detalhe que torna isto perigoso: o dev server NÃO inlina. O defeito só
 * existiria depois do deploy, com o mesmo sintoma do defeito que este trabalho
 * veio consertar. Era a armadilha perfeita, e é por isso que a amarra fica
 * escrita aqui.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import viteConfig from "../../../../vite.config";
import { PCM_CAPTURE_PROCESSOR } from "./voicePcm";

const root = resolve(__dirname, "../../../..");
const WORKLET_FILE = "src/modules/communication/lib/pcm-capture-processor.js";

async function inlineLimit() {
  const config = await viteConfig({ mode: "production", command: "build" });
  return config.build?.assetsInlineLimit;
}

describe("asset do worklet de captura", () => {
  it("é excluído do inline no build de produção", async () => {
    const limit = await inlineLimit();

    // Função, e não número: o resto dos assets segue o padrão do Vite.
    expect(typeof limit).toBe("function");
    expect((limit as (p: string, c: Buffer) => boolean | undefined)(WORKLET_FILE, Buffer.alloc(0)))
      .toBe(false);
  });

  it("não afeta os demais assets", async () => {
    const limit = (await inlineLimit()) as (p: string, c: Buffer) => boolean | undefined;
    expect(limit("src/assets/icone.svg", Buffer.alloc(0))).toBeUndefined();
  });

  it("a CSP de produção não libera `data:` em script-src — daí a exclusão", () => {
    const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
    const csp = dockerfile.match(/Content-Security-Policy\s+\\"([\s\S]*?)\\"\s+always/i);
    expect(csp, "Dockerfile precisa ter o header CSP do nginx").toBeTruthy();

    const scriptSrc = csp![1].match(/script-src([^;]*)/i)?.[1] ?? "";
    expect(scriptSrc).not.toContain("data:");
  });

  it("o processador registrado é o mesmo nome que o código pede", () => {
    const source = readFileSync(resolve(root, WORKLET_FILE), "utf8");

    // O nome vive em dois arquivos que o bundler nunca liga um ao outro: o
    // worklet registra por string, e `voicePcmSession` instancia por string.
    // Divergir dá um erro de runtime obscuro DENTRO da thread de áudio.
    expect(source).toContain(`registerProcessor("${PCM_CAPTURE_PROCESSOR}"`);
  });
});
