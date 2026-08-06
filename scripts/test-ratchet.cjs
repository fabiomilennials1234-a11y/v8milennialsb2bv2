#!/usr/bin/env node
/**
 * Vitest ratchet: roda a suíte unitária e compara vs baseline
 * (.vitest-baseline.json). Reprova SÓ em teste que a sua branch quebrou —
 * nunca no que já estava vermelho.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 * Medido em 2026-08-05 na `develop`: 164 testes vermelhos em 55 arquivos, de
 * 7.718. O job `Unit Tests` do CI reprova desde então, e reprovar sempre é o
 * mesmo que não reprovar nunca — ninguém lê um portão que nasce vermelho. Foi
 * exatamente assim que a feature Leads↔Negócios inteira chegou ao fim da
 * fatia 2 sem um sinal de CI que valesse alguma coisa (`inv:H8-35`).
 *
 * A dívida NÃO é regressão desta feature: o CI rodava só `tests/unit/`, e
 * quando passou a incluir `src/` (PR #1041) apareceram 40 arquivos co-locados
 * que nunca tinham sido executados. A causa dominante é uma só —
 * `No QueryClient set` em teste que monta componente com `useQuery` sem
 * `QueryClientProvider`.
 *
 * ── A MESMA FORMA DOS OUTROS DOIS PORTÕES ─────────────────────────────────
 * Espelha `scripts/lint-ratchet.cjs` e `scripts/tsc-ratchet.cjs`: veredito
 * DELTA (introduzido vs herdado) e output com teto, para não despejar 164
 * falhas herdadas no contexto de quem roda.
 *
 * ── O QUE REPROVA ─────────────────────────────────────────────────────────
 *   1. teste que falha e NÃO está no baseline → introduzido. Bloqueia;
 *   2. arquivo que nem coleta e não está no baseline → idem (erro de import
 *      derruba o arquivo inteiro e some da contagem de testes, que é como
 *      dívida some do radar).
 *
 * Teste do baseline que passou a PASSAR não bloqueia — avisa, e pede o
 * encolhimento do teto:
 *
 *   npm run test:baseline
 *
 * Nunca regenere às cegas: cada linha que sai do baseline é uma correção que
 * merece uma frase no PR. Regenerar para "ficar verde" transforma o portão em
 * enfeite, que é o defeito que este arquivo existe para corrigir.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASELINE_FILE = ".vitest-baseline.json";
const MAX_PRINT = 20;
const ROOT = process.cwd();

const OUT_FILE = path.join(os.tmpdir(), `vitest-ratchet-${process.pid}.json`);

/**
 * Resolve o vitest pelo algoritmo do Node em vez de fixar
 * `./node_modules/vitest`. Em worktree do git não existe `node_modules` local,
 * e caminho fixo faz o portão morrer com `MODULE_NOT_FOUND` — que é
 * exatamente o que acontece hoje com `lint:ratchet` (medido 2026-08-05).
 * Portão que não roda onde o trabalho acontece não é portão.
 */
function acharVitest() {
  try {
    return path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
  } catch {
    return path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
  }
}

/**
 * ── DUAS PASSADAS, E O RETRY SÓ NA SEGUNDA ────────────────────────────────
 * A suíte é instável: três execuções seguidas da MESMA árvore deram 164, 178 e
 * 186 falhas (medido 2026-08-05). Os 22 "novos" de uma delas incluíam teste
 * que só varre arquivo — nada que dependa de estado. Não é falha real: é
 * worker disputando CPU e estourando o timeout de 5 s.
 *
 * Um `--retry=2` global resolveria a instabilidade e criaria um problema pior:
 * cada uma das 178 falhas herdadas passaria a custar três execuções, e o
 * portão levaria mais de meia hora em toda rodada. Portão lento é portão que
 * alguém tira do caminho.
 *
 * Então: passada 1 varre tudo, sem retry. Se aparecer candidato a introduzido,
 * passada 2 roda **só os arquivos desses candidatos**, com `--retry=2`, e o
 * veredito é o da segunda. Caminho comum (nada novo) paga uma passada; o caro
 * só acontece quando há o que julgar. Falha determinística sobrevive às três
 * tentativas; flake não.
 */
function comando(alvos, retry) {
  return (
    `node ${JSON.stringify(acharVitest())} run ${alvos.join(" ")}` +
    (retry ? " --retry=2" : "") +
    ` --reporter=json --outputFile=${JSON.stringify(OUT_FILE)}`
  );
}

const ALVOS = ["tests/unit/", "src/"];

function runVitest(alvos = ALVOS, retry = false) {
  try {
    execSync(comando(alvos, retry), {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch {
    // Vitest sai != 0 quando há teste vermelho — que é o caso normal aqui.
    // O veredito vem do JSON, não do exit code.
  }
  if (!fs.existsSync(OUT_FILE)) {
    console.error("vitest não produziu o relatório JSON esperado em", OUT_FILE);
    process.exit(2);
  }
  const raw = fs.readFileSync(OUT_FILE, "utf8");
  fs.unlinkSync(OUT_FILE);
  return JSON.parse(raw);
}

/** Caminho relativo com barra normal — o baseline precisa casar em Windows e Linux. */
function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/**
 * Chave estável de um teste: `arquivo::nome completo`.
 *
 * Nome completo, e não índice, porque reordenar um `describe` não pode
 * transformar dívida herdada em falha introduzida.
 */
function chaves(report) {
  const falhando = new Set();
  let totalTestes = 0;

  for (const arquivo of report.testResults ?? []) {
    const nome = rel(arquivo.name);
    const asserts = arquivo.assertionResults ?? [];
    totalTestes += asserts.length;

    // Arquivo que nem coletou: erro de import/sintaxe. Não tem assertion
    // nenhuma, então some da contagem — é a forma mais silenciosa de dívida.
    if (asserts.length === 0 && arquivo.status === "failed") {
      falhando.add(`${nome}::<arquivo não coletou>`);
      continue;
    }

    for (const t of asserts) {
      if (t.status === "failed") falhando.add(`${nome}::${t.fullName}`);
    }
  }

  return { falhando, totalTestes };
}

function lerBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null;
  try {
    const b = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
    return new Set(b.falhando ?? []);
  } catch (e) {
    console.error(`${BASELINE_FILE} ilegível:`, e.message);
    process.exit(2);
  }
}

function escreverBaseline(falhando, totalTestes) {
  const conteudo = {
    gerado_em: new Date().toISOString().slice(0, 10),
    nota:
      "Testes vermelhos tolerados. NÃO regenerar às cegas: cada linha que sai " +
      "daqui é uma correção que merece uma frase no PR. Só encolhe.",
    total_de_testes: totalTestes,
    falhando: [...falhando].sort(),
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(conteudo, null, 2) + "\n");
  console.log(`${BASELINE_FILE} escrito: ${falhando.size} teste(s) tolerado(s) de ${totalTestes}.`);
}

function imprimir(titulo, itens) {
  console.log(`\n${titulo} (${itens.length}):`);
  for (const i of itens.slice(0, MAX_PRINT)) console.log(`  ${i}`);
  if (itens.length > MAX_PRINT) console.log(`  … e mais ${itens.length - MAX_PRINT}.`);
}

const escrever = process.argv.includes("--write");
const report = runVitest();
const { falhando, totalTestes } = chaves(report);

if (escrever) {
  escreverBaseline(falhando, totalTestes);
  process.exit(0);
}

const baseline = lerBaseline();
if (!baseline) {
  console.error(
    `${BASELINE_FILE} não existe. Gere uma vez com:\n  npm run test:baseline\n` +
      "e versione o arquivo — sem ele não há como separar herdado de introduzido.",
  );
  process.exit(2);
}

const candidatos = [...falhando].filter((k) => !baseline.has(k)).sort();
const resolvidos = [...baseline].filter((k) => !falhando.has(k)).sort();

if (resolvidos.length > 0) {
  imprimir("✔ Teste(s) do baseline que voltaram a passar — encolha o teto com `npm run test:baseline`", resolvidos);
}

let introduzidos = candidatos;
let instaveis = [];

if (candidatos.length > 0) {
  // Segunda passada, só nos arquivos suspeitos e com retry. É aqui que flake
  // se separa de quebra: quem não sobrevive a três tentativas é real.
  const arquivos = [...new Set(candidatos.map((k) => k.split("::")[0]))];
  console.log(
    `\n${candidatos.length} candidato(s) a falha introduzida em ${arquivos.length} arquivo(s). ` +
      `Confirmando com --retry=2…`,
  );

  const confirmacao = chaves(runVitest(arquivos, true)).falhando;
  introduzidos = candidatos.filter((k) => confirmacao.has(k));
  instaveis = candidatos.filter((k) => !confirmacao.has(k));

  if (instaveis.length > 0) {
    imprimir("~ Instável(is) — falhou na varredura, passou no retry. NÃO bloqueia, mas merece conserto", instaveis);
  }
}

if (introduzidos.length > 0) {
  imprimir("✖ Teste(s) quebrado(s) POR ESTA BRANCH (confirmado com retry)", introduzidos);
  console.error(
    `\nVitest ratchet REPROVOU: ${introduzidos.length} teste(s) introduzido(s). ` +
      `Tolerados: ${baseline.size} de baseline.`,
  );
  process.exit(1);
}

console.log(
  `\nVitest ratchet OK — 0 testes quebrados por esta branch. ` +
    `Tolerados: ${baseline.size} de baseline, de ${totalTestes} testes` +
    (instaveis.length > 0 ? `; ${instaveis.length} instável(is) ignorado(s).` : "."),
);
