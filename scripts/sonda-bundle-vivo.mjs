#!/usr/bin/env node
/**
 * Prova que um commit chegou ao BUNDLE VIVO — pelo marcador, nunca pelo hash.
 *
 * ── POR QUE ISTO EXISTE ───────────────────────────────────────────────────
 * Merge na `main` deploya sozinho (webhook do EasyPanel), em algo entre 3 e 48
 * minutos. Não dá para prometer janela: o que dá é sondar cedo e repetir. E não
 * adianta comparar hash de chunk — o nome muda a cada build, inclusive em build
 * que não contém a sua mudança.
 *
 * ── A ARMADILHA QUE ESTA FERRAMENTA EXISTE PARA EVITAR ────────────────────
 * 🚨 "O marcador existe no chunk?" é a pergunta ERRADA. Uma versão anterior
 * desta sonda, com janela de ±3000 chars, deu FALSO POSITIVO: havia `z-[70]`
 * na janela, mas vindo de OUTRO componente. `modal:!0` aparece 9 vezes no
 * bundle; `z-[70]` aparece em vários.
 *
 * A pergunta certa é **"a ocorrência mais PRÓXIMA da âncora tem o marcador?"**
 * — por isso todo marcador do modo `perto` traz uma âncora, que é uma string
 * exclusiva daquele componente, e uma janela curta.
 *
 * ── COMO ESCOLHER MARCADOR ────────────────────────────────────────────────
 * Marcador só vale se for **novo neste commit**. Prove antes de confiar:
 *
 *   git grep -c '<marcador>' <commit-anterior> -- 'src/*.tsx'   # tem de dar 0
 *   git grep -c '<marcador>' origin/main       -- 'src/*.tsx'   # tem de dar 1
 *
 * E leve sempre um CONTROLE: uma string que já existia e deve PERMANECER. Sem
 * ele, "0 de 3 marcadores" não distingue "não deployou ainda" de "sondei o
 * arquivo errado".
 *
 * ── USO ───────────────────────────────────────────────────────────────────
 *   node scripts/sonda-bundle-vivo.mjs <arquivo-de-marcadores.json>
 *
 * O JSON:
 *   {
 *     "url": "https://app.torquecrm.com.br",
 *     "marcadores": [
 *       { "nome": "…", "modo": "exato",  "texto": "z-[70] w-64 p-2" },
 *       { "nome": "…", "modo": "perto", "ancora": "Buscar cliente...",
 *         "texto": "modal:!0", "janela": 600 }
 *     ],
 *     "controles": [ { "nome": "…", "texto": "Adicionar produto" } ]
 *   }
 *
 * Sai 0 se todos os marcadores e controles baterem; 1 caso contrário.
 */
import { readFileSync } from "node:fs";

const cfgPath = process.argv[2];
if (!cfgPath) {
  console.error("uso: node scripts/sonda-bundle-vivo.mjs <marcadores.json>");
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const base = cfg.url.replace(/\/$/, "");

async function texto(u) {
  const r = await fetch(u, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return r.text();
}

/**
 * A lista de chunks sai do `sw.js` (precache do Workbox), não do `index.html`.
 * O `index.html` aponta só para a entrada; o código de uma tela específica mora
 * num chunk lazy, que só o manifesto nomeia.
 *
 * ⚠️ O manifesto nomeia os arquivos SEM barra na frente (`assets/x.js`).
 */
async function chunks() {
  const sw = await texto(`${base}/sw.js`);
  const achados = new Set();
  for (const m of sw.matchAll(/["']([^"']*assets\/[^"']+\.js)["']/g)) {
    achados.add(m[1].replace(/^\.?\//, ""));
  }
  // Rede de segurança: a entrada do index.html, caso o sw.js falhe ou mude.
  const html = await texto(`${base}/index.html`);
  for (const m of html.matchAll(/src="\/?([^"]*assets\/[^"]+\.js)"/g)) {
    achados.add(m[1].replace(/^\.?\//, ""));
  }
  return [...achados];
}

function acha(fonte, marcador) {
  if (marcador.modo === "exato") {
    return fonte.includes(marcador.texto);
  }
  // modo "perto": a ocorrência mais PRÓXIMA da âncora precisa ter o marcador.
  const janela = marcador.janela ?? 600;
  let i = fonte.indexOf(marcador.ancora);
  while (i !== -1) {
    const antes = fonte.slice(Math.max(0, i - janela), i);
    if (antes.includes(marcador.texto)) return true;
    i = fonte.indexOf(marcador.ancora, i + 1);
  }
  return false;
}

const lista = await chunks();
console.log(`${lista.length} chunk(s) no manifesto de ${base}\n`);

const corpos = [];
for (const c of lista) {
  try {
    corpos.push(await texto(`${base}/${c}`));
  } catch {
    /* chunk que sumiu entre o manifesto e agora — o build trocou no meio */
  }
}

let falhou = false;

for (const m of cfg.marcadores) {
  const ok = corpos.some((f) => acha(f, m));
  if (!ok) falhou = true;
  const como = m.modo === "perto" ? ` (perto de "${m.ancora}")` : "";
  console.log(`${ok ? "✅" : "❌"} ${m.nome}${como}`);
}

for (const c of cfg.controles ?? []) {
  const ok = corpos.some((f) => f.includes(c.texto));
  if (!ok) falhou = true;
  console.log(`${ok ? "✅" : "🚨"} CONTROLE ${c.nome} — devia estar presente`);
}

console.log(
  falhou
    ? "\nAINDA NÃO. Se os CONTROLES passaram, é só o deploy não ter saído — sonde de novo."
    : "\nNO AR — todos os marcadores e controles bateram.",
);
process.exit(falhou ? 1 : 0);
