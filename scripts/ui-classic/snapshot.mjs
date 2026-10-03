#!/usr/bin/env node
/**
 * Gera `classic/` — a interface clássica congelada — a partir de um ref do git.
 *
 *   node scripts/ui-classic/snapshot.mjs [--ref origin/main]   # extrai + aplica o patch
 *   node scripts/ui-classic/snapshot.mjs --ref <ref velho> --provisorio
 *                                    # só para validar local; o build de produção recusa
 *   node scripts/ui-classic/snapshot.mjs --gerar-patch         # classic/ editada → patch
 *
 * O que vem do ref: `src/` (sem testes, stories e .md), `index.html` e
 * `tailwind.config.ts`. O resto de `classic/` (vite.config.ts, README.md,
 * SNAPSHOT.json) é mantido à mão e não é tocado.
 *
 * Por cima do ref vai `scripts/ui-classic/classic.patch`: o mínimo para a
 * clássica saber trocar de interface (guarda, switch, hook) e o Tailwind olhar
 * a própria pasta. Conserto na clássica = editar `classic/`, rodar
 * `--gerar-patch`, commitar os dois. Ver docs/ui-v5/interface-por-organizacao.md.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLASSIC = join(RAIZ, "classic");
const PATCH = join(RAIZ, "scripts/ui-classic/classic.patch");
const DO_REF = ["src", "index.html", "tailwind.config.ts"];

const args = process.argv.slice(2);
const opt = (nome, padrao) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : padrao;
};
const ref = opt("--ref", "origin/main");

const git = (...a) => execFileSync("git", a, { cwd: RAIZ, encoding: "utf8" }).trim();

/** Teste, story e doc não entram na build e só confundiriam as varreduras do repo. */
function podarArquivos(dir) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) {
      if (nome === "__tests__") rmSync(p, { recursive: true, force: true });
      else podarArquivos(p);
    } else if (/\.(test|spec|stories)\.[jt]sx?$/.test(nome) || nome.endsWith(".md")) {
      rmSync(p);
    }
  }
}

function extrair(destino) {
  for (const p of DO_REF) rmSync(join(destino, p), { recursive: true, force: true });
  const tar = execFileSync("git", ["archive", "--format=tar", ref, ...DO_REF], { cwd: RAIZ, maxBuffer: 1 << 30 });
  execFileSync("tar", ["-x", "-C", destino], { input: tar });
  podar(join(destino, "src"));
}

/**
 * `src/assets` (logos, mapas — 3,4 MB) é o mesmo nas duas interfaces: a
 * clássica lê o da V5 pelo alias `@/assets` do classic/vite.config.ts. Todo
 * import de asset no front usa `@/assets/…`; import relativo quebraria o build.
 */
function podar(dir) {
  podarArquivos(dir);
  rmSync(join(dir, "assets"), { recursive: true, force: true });
}

if (args.includes("--gerar-patch")) {
  const { ref: refDoSnapshot } = JSON.parse(readFileSync(join(CLASSIC, "SNAPSHOT.json"), "utf8"));
  // Pasta ignorada pelo git DENTRO do repo: o diff sai com caminhos relativos,
  // e basta trocar o prefixo da pristina pelo de `classic/`.
  const PRISTINA = ".tmp/ui-classic-pristina";
  rmSync(join(RAIZ, PRISTINA), { recursive: true, force: true });
  execFileSync("mkdir", ["-p", join(RAIZ, PRISTINA)]);
  // Mesmo commit do snapshot, não o ref de agora: o patch é só a NOSSA mudança.
  execFileSync("tar", ["-x", "-C", join(RAIZ, PRISTINA)], {
    input: execFileSync("git", ["archive", "--format=tar", refDoSnapshot, ...DO_REF], { cwd: RAIZ, maxBuffer: 1 << 30 }),
  });
  podar(join(RAIZ, PRISTINA, "src"));
  let patch = "";
  for (const p of DO_REF) {
    const r = spawnSync("git", ["diff", "--no-index", "--binary", `${PRISTINA}/${p}`, `classic/${p}`], {
      cwd: RAIZ,
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
    if (r.status !== 0 && r.status !== 1) throw new Error(r.stderr);
    patch += r.stdout;
  }
  patch = patch.split(`a/${PRISTINA}/`).join("a/classic/");
  writeFileSync(PATCH, patch);
  rmSync(join(RAIZ, PRISTINA), { recursive: true, force: true });
  console.log(`patch: ${relative(RAIZ, PATCH)} (${patch.split("\n").length} linhas)`);
  process.exit(0);
}

const sha = git("rev-parse", ref);
extrair(CLASSIC);
if (existsSync(PATCH) && readFileSync(PATCH, "utf8").trim()) {
  execFileSync("git", ["apply", "--whitespace=nowarn", PATCH], { cwd: RAIZ, stdio: "inherit" });
}
// Provisória = não veio do que está em produção (origin/main). O build de
// produção (merge-dist.mjs) recusa: mergear com a clássica de um ref velho
// rebaixaria o front de todas as orgs que ficam nela.
const provisoria = args.includes("--provisorio");
writeFileSync(
  join(CLASSIC, "SNAPSHOT.json"),
  `${JSON.stringify({ ref: sha, origem: ref, geradoEm: new Date().toISOString().slice(0, 10), ...(provisoria && { provisoria: true }) }, null, 2)}\n`,
);
console.log(`classic/ ← ${ref} (${sha.slice(0, 9)})${existsSync(PATCH) ? " + classic.patch" : ""}`);
