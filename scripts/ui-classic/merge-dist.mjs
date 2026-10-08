#!/usr/bin/env node
/**
 * Junta a build clássica (dist-classic/) na build V5 (dist/) para o mesmo nginx
 * servir as duas pela mesma origem. Roda depois de `build` e `build:classic`
 * (`npm run build:dual`).
 *
 * - assets: UNIÃO. Os nomes têm hash de conteúdo, então não colidem — e uma aba
 *   que pede um chunk depois que a org trocou de interface não toma 404. Mesmo
 *   nome com conteúdo diferente aborta o build.
 * - index.html da clássica → dist/index.classic.html
 * - sw.js da clássica      → dist/sw.classic.js (+ .map)
 *
 * O nginx escolhe index e sw pelo cookie `torque_ui` (Dockerfile). O resto da
 * raiz (manifest, ícones, public/) é o mesmo nas duas e fica o da V5.
 */
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const V5 = join(RAIZ, "dist");
const CLASSICA = join(RAIZ, "dist-classic");

// Clássica gerada de um ref que não é o de produção (snapshot.mjs --provisorio).
// Ir ao ar assim rebaixaria o front de todas as orgs na clássica.
const snapshot = JSON.parse(readFileSync(join(RAIZ, "classic/SNAPSHOT.json"), "utf8"));
if (snapshot.provisoria && process.env.UI_CLASSIC_PERMITE_PROVISORIA !== "1") {
  console.error(
    `✖ classic/ é PROVISÓRIA (ref ${String(snapshot.ref).slice(0, 9)}). Regenere a partir da main antes de buildar para produção:\n` +
      "    npm run ui-classic:snapshot -- --ref origin/main\n" +
      "  (validação local: UI_CLASSIC_PERMITE_PROVISORIA=1)",
  );
  process.exit(1);
}

for (const [nome, dir] of [["dist", V5], ["dist-classic", CLASSICA]]) {
  if (!existsSync(join(dir, "index.html"))) {
    console.error(`✖ ${nome}/index.html não existe — rode o build correspondente antes.`);
    process.exit(1);
  }
}

let copiados = 0;
let iguais = 0;
function unir(origem, destino) {
  mkdirSync(destino, { recursive: true });
  for (const nome of readdirSync(origem)) {
    const de = join(origem, nome);
    const para = join(destino, nome);
    if (statSync(de).isDirectory()) {
      unir(de, para);
      continue;
    }
    // Cópia exclusiva: falha se o destino já existe, em vez de checar antes e
    // copiar depois (CodeQL: file system race condition).
    try {
      copyFileSync(de, para, constants.COPYFILE_EXCL);
      copiados++;
      continue;
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
    }
    // Chunk idêntico nas duas builds (mesmo hash) e mapa diferente só porque
    // os `sources` apontam para src/ num e classic/src/ no outro: fica o da
    // V5. JS/CSS com o mesmo nome e conteúdo diferente, não — aborta.
    if (nome.endsWith(".map")) {
      iguais++;
      continue;
    }
    if (!readFileSync(de).equals(readFileSync(para))) {
      console.error(`✖ colisão de asset com conteúdo diferente: ${relative(RAIZ, para)}`);
      process.exit(1);
    }
    iguais++;
  }
}
unir(join(CLASSICA, "assets"), join(V5, "assets"));

copyFileSync(join(CLASSICA, "index.html"), join(V5, "index.classic.html"));

if (existsSync(join(CLASSICA, "sw.js"))) {
  const sw = readFileSync(join(CLASSICA, "sw.js"), "utf8").replace(
    /\/\/# sourceMappingURL=sw\.js\.map\s*$/,
    "//# sourceMappingURL=sw.classic.js.map\n",
  );
  writeFileSync(join(V5, "sw.classic.js"), sw);
  if (existsSync(join(CLASSICA, "sw.js.map"))) copyFileSync(join(CLASSICA, "sw.js.map"), join(V5, "sw.classic.js.map"));
} else {
  console.error("✖ dist-classic/sw.js não existe — a clássica sem service worker serviria o SW da V5.");
  process.exit(1);
}

console.log(
  `dist/ ← clássica: ${copiados} assets novos, ${iguais} já iguais (vendor compartilhado), index.classic.html, sw.classic.js`,
);
