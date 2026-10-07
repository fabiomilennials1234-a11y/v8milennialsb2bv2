#!/usr/bin/env node
/**
 * Deploy do front em produção (Cloudflare Workers), em degraus, com rollback
 * automático. Roda no job `deploy` de .github/workflows/deploy-front-cloudflare.yml.
 *
 *   node scripts/cloudflare/ci-deploy.mjs --smoke-url <origem> --tag <sha> --message <texto> [--drill] [--summary <arquivo>]
 *   node scripts/cloudflare/ci-deploy.mjs --rollback-to <version-id> --smoke-url <origem> [--summary <arquivo>]
 *
 * Deploy (o artefato é sempre cloudflare/.assets, o diretório do wrangler.jsonc):
 *   0. `--tag` tem de ser o HEAD da main AGORA (`git ls-remote`, sem
 *      credencial): re-run de execução antiga não publica sha velho;
 *   1. guarda a versão em 100 % (`deployments status --json`); deployment
 *      dividido entre versões = alguém está no meio de algo, e o CI não mexe;
 *   2. `versions upload --tag <sha> --message …` — o id sai do ND-JSON de
 *      WRANGLER_OUTPUT_FILE_PATH, não do texto do terminal;
 *   3. `versions deploy <nova>@0% <anterior>@100%`;
 *   4. smoke A com `Cloudflare-Workers-Version-Overrides`, exigindo
 *      `X-Torque-Version` = nova em toda resposta do Worker. Falhou → volta a
 *      deployment para `<anterior>@100%` e para aqui. A nova NUNCA recebe
 *      tráfego sem passar no A;
 *   5. `versions deploy <nova>@100%`;
 *   6. `triggers deploy` (workers.dev e preview URLs do wrangler.jsonc);
 *   7. smoke B sem override: espera a propagação (X-Torque-Version = nova) e
 *      só então avalia, por até 3 min;
 *   8. qualquer falha depois do passo 5 → `versions deploy <anterior>@100%`
 *      automático, smoke autoconsistente da anterior, e saída vermelha. Vale
 *      também para SIGINT/SIGTERM (job cancelado ou estourou o prazo) entre o
 *      passo 5 e o B verde.
 *
 * `--drill` (só com --smoke-url em *.workers.dev): faz tudo e, com o B verde,
 * força o rollback do passo 8 — para exercitar o caminho que só roda quando
 * produção quebra. Sai 0 se o rollback e o smoke da anterior passarem.
 *
 * Rollback manual (`--rollback-to`): `versions deploy <id>@100%` + smoke
 * autoconsistente (não há artefato local daquela versão).
 *
 * Saída: 0 ok · 1 falha · 2 uso · 3 BLOQUEADO (desafio da zona no smoke: o
 * smoke não chegou ao Worker; nada é promovido e nada é desfeito por isso) ·
 * 4 OBSOLETO (o sha não é mais o HEAD da main; nada publicado) · 130/143
 * interrompido por SIGINT/SIGTERM.
 *
 * LOG PÚBLICO (repositório público). Nada do wrangler vai cru para o log:
 *   - o stdout do `deployments status --json` (que traz `author_email`) nunca
 *     é ecoado — só o `id@pct` já lido;
 *   - o resto passa por `filterWranglerOutput`, uma LISTA DE PERMISSÃO: blocos
 *     [ERROR]/[WARNING] e as linhas de progresso conhecidas. A saída do
 *     `whoami` que o wrangler imprime em erro de autenticação (nome da conta,
 *     ids, permissões do token, e-mail) é cortada inteira, e qualquer e-mail ou
 *     id de 32 hex que sobre é mascarado.
 * Nunca imprime variável de ambiente. O token chega ao wrangler pelo ambiente
 * herdado (CLOUDFLARE_API_TOKEN), e só o wrangler o lê.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CLOUDFLARE_DIR, listFiles, parseArgs } from "./lib.mjs";
import { DEFAULT_OUT as ASSETS_DIR, REQUIRED_FILES } from "./prepare-assets.mjs";
import { EXIT as SMOKE_EXIT, WORKER_NAME, formatSmoke, isWorkersDev, parseSmokeUrl, smokeUntilPass } from "./smoke.mjs";

/** O CLI de verdade (o bin/wrangler.js só o re-executa num filho, que um kill no pai deixaria órfão). */
export const WRANGLER_CLI = path.join(CLOUDFLARE_DIR, "node_modules", "wrangler", "wrangler-dist", "cli.js");
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TAG = /^[0-9a-f]{7,40}$/;
const MESSAGE = /^[\x20-\x7e]{1,100}$/;

export const EXIT = Object.freeze({ ...SMOKE_EXIT, OBSOLETO: 4, SIGINT: 130, SIGTERM: 143 });

/** De onde vem o HEAD da main (repositório público: leitura sem credencial). */
export const MAIN_REPO_URL = "https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2";
export const MAIN_REF = "refs/heads/main";

/** Propagação: o A espera até 2 min pela versão a 0 %; o B, até 3 min pela promoção. */
export const RETRY = Object.freeze({ smokeA: 120_000, smokeB: 180_000, afterRollback: 180_000 });

/**
 * Prazo de cada comando. Um wrangler pendurado é morto e conta como falha —
 * depois da promoção, isso vira rollback. `interrupt`: o rollback do
 * SIGINT/SIGTERM tem até a hora do SIGKILL do runner (≈ 10 s).
 */
export const TIMEOUTS = Object.freeze({ git: 15_000, status: 60_000, upload: 300_000, deploy: 60_000, triggers: 60_000, interrupt: 8_000 });

export class DeployUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "DeployUsageError";
  }
}

export class WranglerError extends Error {
  constructor(message) {
    super(message);
    this.name = "WranglerError";
  }
}

// ── saída do wrangler para o log público ────────────────────────────────────

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const HEX32 = /\b[0-9a-fA-F]{32}\b/g;

/**
 * Começo da saída de `whoami` que o wrangler imprime depois de um erro de
 * autenticação (cli.js 4.147.0: 363433-363455 chama `whoami`; 351240-351370
 * imprime). Achou um destes, o resto da saída é cortado.
 */
const WHOAMI = [
  /authenticating Wrangler via a custom API token/i,
  /Getting User settings/i,
  /You are logged in with/i,
  /You are not authenticated/i,
  /API Token is read from/i,
  /Credentials are stored in/i,
  /\bAccount Name\b/,
  /Token Permissions/i,
  /To see token permissions/i,
  /Membership roles/i,
  /compliance region is set/i,
];

/** Linhas de progresso que podem ir ao log (comparadas sem a moldura e o emoji do wrangler). */
const ALLOWED = [
  /^Total Upload: /,
  /^Worker Startup Time: /,
  /^Your Worker has access to the following bindings:$/,
  /^Binding\s+Resource$/,
  /^env\.[A-Z0-9_]+\b/,
  /^Uploaded torque-front \(/,
  /^Worker Version ID: [0-9a-f-]{36}$/,
  /^Building list of assets/,
  /^Starting asset upload/,
  /^Found \d+ new or modified static assets? to upload/,
  /^Uploaded \d+ of \d+ assets?/,
  /^Success! Uploaded \d+ files?/,
  /^No (updated )?(asset )?files to upload/i,
  /^Deploy Worker Versions/,
  /^\(\d+%\) [0-9a-f-]{36}$/,
  /^Worker Version \d+:\s+[0-9a-f-]{36}$/,
  /Deployed torque-front version [0-9a-f-]{36} at \d+%/,
  /^Deployed torque-front triggers/,
  /^No non-versioned settings to sync/,
  /^Syncing non-versioned settings/,
  /^--dry-run: exiting/,
];

const redact = (line) => line.replace(EMAIL, "<email>").replace(HEX32, "<id>");

/**
 * O que da saída do wrangler pode ir para o log público. Lista de permissão:
 * blocos [ERROR]/[WARNING] (com as linhas recuadas que os seguem) e as linhas
 * de ALLOWED; o resto é contado e descartado. A saída de whoami é cortada
 * inteira. E-mail vira `<email>` e id de 32 hex (conta) vira `<id>`.
 * Devolve `{ lines, omitted, whoami }`.
 */
export function filterWranglerOutput(text) {
  const lines = [];
  let omitted = 0;
  let whoami = false;
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(ANSI, "").replace(/\s+$/, "");
    if (whoami) {
      if (line) omitted += 1;
      continue;
    }
    if (/\[(ERROR|WARNING)\]/.test(line)) {
      inBlock = true;
      lines.push(redact(line));
      continue;
    }
    if (WHOAMI.some((pattern) => pattern.test(line))) {
      whoami = true;
      omitted += 1;
      continue;
    }
    if (inBlock && (line === "" || /^\s/.test(line))) {
      lines.push(redact(line));
      continue;
    }
    inBlock = false;
    if (line === "") continue;
    const core = line
      .replace(/^[\s│├╰╭┌└─╮╯┃▲✘]+/u, "")
      .replace(/^(SUCCESS|🌀|✨|⛅️|👋)\s*/u, "")
      .trim();
    if (ALLOWED.some((pattern) => pattern.test(core))) lines.push(redact(line));
    else omitted += 1;
  }
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return { lines, omitted, whoami };
}

// ── wrangler ────────────────────────────────────────────────────────────────

/**
 * @typedef {{ outputFile?: string, echo?: boolean, timeoutMs?: number }} ExecOptions
 * @typedef {{ code: number, stdout: string, timedOut?: boolean }} ExecResult
 * @typedef {(args: string[], opts: ExecOptions) => Promise<ExecResult>} Exec
 * @typedef {(command: string, args: string[], options: any) => any} SpawnImpl
 */

/** Os wranglers em execução: o SIGINT/SIGTERM os mata antes do rollback (senão um `promove` em voo correria com ele). */
const active = new Set();
export function killActiveWranglers() {
  for (const child of active) child.kill("SIGKILL");
  active.clear();
}

/**
 * Executa o wrangler do cloudflare/package-lock.json, com o wrangler.jsonc
 * (cwd cloudflare/). stdout e stderr são capturados; ao log só vai o que
 * `filterWranglerOutput` deixa — e nada, com `echo: false`, se deu certo.
 * Passou de `timeoutMs`: o processo morre e o código é 124.
 *
 * @param {string[]} args
 * @param {ExecOptions} [options]
 * @param {{ spawnImpl?: SpawnImpl, write?: (text: string) => unknown }} [deps]
 * @returns {Promise<ExecResult>}
 */
export function spawnWrangler(args, { outputFile, echo = true, timeoutMs = TIMEOUTS.deploy } = {}, { spawnImpl = spawn, write = (text) => process.stdout.write(text) } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };
    delete env.WRANGLER_OUTPUT_FILE_DIRECTORY;
    // O token do GitHub só serve ao `git ls-remote`; o wrangler não o recebe.
    delete env.GITHUB_TOKEN;
    if (outputFile) env.WRANGLER_OUTPUT_FILE_PATH = outputFile;
    else delete env.WRANGLER_OUTPUT_FILE_PATH;
    const child = spawnImpl(process.execPath, ["--no-warnings", WRANGLER_CLI, ...args], { cwd: CLOUDFLARE_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
    active.add(child);
    const stdout = [];
    const all = [];
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      all.push(chunk);
    });
    child.stderr.on("data", (chunk) => all.push(chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      active.delete(child);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      active.delete(child);
      const failed = timedOut || code !== 0;
      if (echo || failed) {
        const { lines, omitted, whoami } = filterWranglerOutput(Buffer.concat(all).toString("utf8"));
        if (omitted > 0) {
          lines.push(`(wrangler ${args.slice(0, 2).join(" ")}: ${omitted} linha(s) fora do log público${whoami ? ", inclusive a saída de whoami — conta e permissões do token" : ""})`);
        }
        if (lines.length > 0) write(`${lines.join("\n")}\n`);
      }
      resolve({ code: timedOut ? 124 : (code ?? 1), stdout: Buffer.concat(stdout).toString("utf8"), timedOut });
    });
  });
}

/** O JSON do `deployments status --json`; tolera aviso do wrangler em volta. A mensagem de erro nunca cita o conteúdo. */
export function parseDeploymentStatus(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new WranglerError("deployments status --json não devolveu JSON");
  let status;
  try {
    status = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    throw new WranglerError("deployments status --json devolveu JSON ilegível");
  }
  if (!Array.isArray(status.versions)) throw new WranglerError("deployments status --json sem `versions`");
  return status;
}

/** O `version_id` do último registro `version-upload` do ND-JSON do wrangler. */
export function parseUploadOutput(ndjson) {
  let versionId = null;
  for (const line of ndjson.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new WranglerError("o ND-JSON do wrangler tem uma linha ilegível");
    }
    if (entry.type === "version-upload") versionId = entry.version_id ?? null;
  }
  if (!versionId || !UUID.test(versionId)) throw new WranglerError(`versions upload não registrou um version_id válido (${versionId})`);
  return versionId;
}

/**
 * As quatro operações de que o deploy precisa, sobre um `exec(args, opts)`.
 * O `exec` real é `spawnWrangler`; os testes o dublam e conferem os argumentos.
 *
 * @param {{ exec?: Exec, workerName?: string, tmpDir?: string }} [options]
 */
export function createWrangler({ exec = spawnWrangler, workerName = WORKER_NAME, tmpDir = os.tmpdir() } = {}) {
  const run = async (args, opts) => {
    const result = await exec(args, opts);
    if (result.timedOut) throw new WranglerError(`wrangler ${args.slice(0, 2).join(" ")} não terminou em ${opts.timeoutMs / 1000} s`);
    if (result.code !== 0) throw new WranglerError(`wrangler ${args.slice(0, 2).join(" ")} saiu com ${result.code}`);
    return result;
  };
  return {
    async status() {
      // echo: false — o JSON da API traz `author_email` (cli.js 354655).
      const { stdout } = await run(["deployments", "status", "--json", "--name", workerName], { echo: false, timeoutMs: TIMEOUTS.status });
      return parseDeploymentStatus(stdout);
    },
    async upload({ tag, message }) {
      const outputFile = path.join(fs.mkdtempSync(path.join(tmpDir, "wrangler-out-")), "output.ndjson");
      try {
        await run(["versions", "upload", "--tag", tag, "--message", message], { outputFile, timeoutMs: TIMEOUTS.upload });
        return parseUploadOutput(fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "");
      } finally {
        fs.rmSync(path.dirname(outputFile), { recursive: true, force: true });
      }
    },
    /**
     * `traffic` = [[versionId, porcentagem], …]; soma 100.
     * @param {[string, number][]} traffic
     * @param {string} message
     * @param {{ timeoutMs?: number }} [options]
     */
    async deploy(traffic, message, { timeoutMs = TIMEOUTS.deploy } = {}) {
      for (const [id, pct] of traffic) {
        if (!UUID.test(id) || !Number.isInteger(pct) || pct < 0 || pct > 100) throw new WranglerError(`tráfego inválido: ${id}@${pct}%`);
      }
      if (traffic.reduce((sum, [, pct]) => sum + pct, 0) !== 100) throw new WranglerError("o tráfego precisa somar 100 %");
      await run(["versions", "deploy", ...traffic.map(([id, pct]) => `${id}@${pct}%`), "--yes", "--message", message, "--name", workerName], { timeoutMs });
    },
    async triggers() {
      await run(["triggers", "deploy"], { timeoutMs: TIMEOUTS.triggers });
    },
  };
}

/**
 * O HEAD da main agora, por `git ls-remote`, sem config global nem do sistema
 * (nada de credential helper ou insteadOf herdado) e sem prompt.
 *
 * Repositório público: sem credencial nenhuma. Repositório privado: com
 * `GITHUB_TOKEN` (o token do job, `contents: read`), o git manda
 * `AUTHORIZATION: basic …` só para a origem de `url`, pela configuração em
 * variável de ambiente (`GIT_CONFIG_COUNT`/`KEY_0`/`VALUE_0`, git ≥ 2.31) —
 * o mesmo header que o actions/checkout usa. O token nunca vai na linha de
 * comando (visível no `ps` de qualquer processo da máquina) nem na URL, e o
 * stderr do git é descartado. Sem token num repo privado, o passo falha e
 * nada é publicado.
 *
 * Fora de qualquer repositório: no cwd do checkout o git leria o `.git/config`
 * LOCAL (um `url.<x>.insteadOf` ali redirecionaria o ls-remote para outro
 * lugar), e `GIT_CONFIG_NOSYSTEM`/`GIT_CONFIG_GLOBAL` não cobrem o local. Por
 * isso o git roda num diretório novo e vazio dentro de `tmpBase`, com
 * `GIT_CEILING_DIRECTORIES=tmpBase`: ele não acha repo nem subindo.
 *
 * @param {{ spawnImpl?: SpawnImpl, url?: string, timeoutMs?: number, token?: string, tmpBase?: string }} [options]
 * @returns {Promise<string>}
 */
export function remoteMainHead({ spawnImpl = spawn, url = MAIN_REPO_URL, timeoutMs = TIMEOUTS.git, token = process.env.GITHUB_TOKEN, tmpBase = os.tmpdir() } = {}) {
  return new Promise((resolve, reject) => {
    const base = fs.realpathSync(tmpBase);
    const cwd = fs.mkdtempSync(path.join(base, "ls-remote-"));
    const cleanup = () => fs.rmSync(cwd, { recursive: true, force: true });
    const env = { PATH: process.env.PATH ?? "", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull, GIT_CEILING_DIRECTORIES: base };
    if (token?.trim()) {
      const basic = Buffer.from(`x-access-token:${token.trim()}`).toString("base64");
      env.GIT_CONFIG_COUNT = "1";
      env.GIT_CONFIG_KEY_0 = `http.${new URL(url).origin}/.extraheader`;
      env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basic}`;
    }
    const child = spawnImpl("git", ["-c", "credential.helper=", "ls-remote", "--exit-code", url, MAIN_REF], { cwd, env, stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      cleanup();
      const match = Buffer.concat(chunks).toString("utf8").match(/^([0-9a-f]{40})\trefs\/heads\/main$/m);
      if (code === 0 && match) resolve(match[1]);
      else reject(new Error(`git ls-remote ${MAIN_REF} saiu com ${code} sem o sha`));
    });
  });
}

// ── relatório ───────────────────────────────────────────────────────────────

function createReport(kind) {
  const steps = [];
  return {
    kind,
    steps,
    facts: {},
    step(name, ok, detail = "") {
      steps.push({ name, ok, detail });
    },
  };
}

/** Markdown para o $GITHUB_STEP_SUMMARY. Só ids de versão, URLs e resultados — nada do ambiente. */
export function renderSummary(report, outcome) {
  const lines = [`## Front na Cloudflare — ${report.kind}`, "", `**${outcome}**`, ""];
  const facts = Object.entries(report.facts).filter(([, v]) => v !== undefined && v !== null);
  if (facts.length > 0) {
    lines.push("| | |", "|---|---|");
    for (const [key, value] of facts) lines.push(`| ${key} | \`${String(value).replace(/[`|\n]/g, " ")}\` |`);
    lines.push("");
  }
  lines.push("| Etapa | Resultado |", "|---|---|");
  for (const { name, ok, detail } of report.steps) {
    lines.push(`| ${name} | ${ok === true ? "ok" : ok === false ? "**FALHOU**" : "—"}${detail ? ` — ${detail.replace(/[|\n]/g, " ")}` : ""} |`);
  }
  return `${lines.join("\n")}\n`;
}

const smokeDetail = (result) => {
  const failed = result.checks.filter((c) => c.problems.length > 0);
  const first = failed.slice(0, 3).map((c) => `${c.name}: ${c.problems[0]}`);
  return `${result.outcome}, ${result.checks.length} verificações, ${failed.length} com problema, ${result.attempts ?? 1} tentativa(s)${first.length ? ` (${first.join("; ")})` : ""}`;
};

// ── fluxos ──────────────────────────────────────────────────────────────────

/**
 * Antes de qualquer chamada: sem token o wrangler cairia no `wrangler login`
 * (que em CI não existe) com uma mensagem que não diz o que fazer.
 */
export function assertCredentials(env) {
  const problems = [];
  if (!env.CLOUDFLARE_API_TOKEN?.trim()) {
    problems.push("CLOUDFLARE_API_TOKEN ausente: crie o secret no environment front-production (docs/DEPLOY_CLOUDFLARE.md, \"Passo a passo do CTO\")");
  }
  if (!/^[0-9a-f]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "")) {
    problems.push("CLOUDFLARE_ACCOUNT_ID ausente ou fora do formato (32 hex): variável do environment front-production");
  }
  if (problems.length > 0) throw new DeployUsageError(`${problems.join("\n")}\nNada foi publicado.`);
}

/** A pasta que o wrangler.jsonc publica, com a build dual inteira e sem source map. */
export function assertAssetsReady(dir = ASSETS_DIR) {
  const missing = [...REQUIRED_FILES, "_headers", ".assetsignore"].filter((name) => !fs.existsSync(path.join(dir, name)));
  if (missing.length > 0) throw new DeployUsageError(`${dir} incompleto (${missing.join(", ")}): baixe o artefato do job build`);
  const maps = listFiles(dir).filter((file) => file.endsWith(".map"));
  if (maps.length > 0) throw new DeployUsageError(`${dir} tem source map (${maps.slice(0, 3).join(", ")}): o artefato não passou pelo cf:prepare`);
}

/** Uma etapa que pode lançar: registra e devolve `true` se passou. */
async function attempt(report, log, name, action) {
  try {
    const detail = await action();
    report.step(name, true, typeof detail === "string" ? detail : "");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`ERRO em "${name}": ${message}`);
    report.step(name, false, message);
    return false;
  }
}

/**
 * O smoke nunca derruba o fluxo: uma exceção dele (artefato ilegível, bug)
 * vira FAIL — senão uma exceção no smoke B deixaria a versão nova em 100 %
 * sem rollback.
 */
function guardSmoke(smoke) {
  return async (options) => {
    try {
      return await smoke(options);
    } catch (error) {
      return { outcome: "FAIL", attempts: 1, blockedBy: [], checks: [{ name: "smoke", problems: [`exceção: ${error instanceof Error ? error.message : String(error)}`] }] };
    }
  };
}

/** Estado que o SIGINT/SIGTERM consulta: há uma versão promovida sem o B verde? */
export function createDeployState() {
  return { previous: null, next: null, promoting: false, settled: true, report: null };
}

/**
 * Volta `previous` para 100 % e confere com smoke autoconsistente (a
 * anterior pode ser de antes do X-Torque-Version: header ausente serve,
 * outro id não). Devolve "ok", "smoke" (voltou, mas a anterior falhou no
 * smoke) ou "deploy" (nem voltou: ação manual).
 */
async function rollbackTo(previous, { wrangler, smoke, log, report, smokeUrl, label, state }) {
  const back = await attempt(report, log, `rollback: versions deploy ${previous}@100%`, () => wrangler.deploy([[previous, 100]], label));
  if (!back) {
    log(`ROLLBACK FALHOU. Produção pode estar na versão nova. Rode o workflow com rollback_to=${previous}, ou: wrangler rollback ${previous} --name ${WORKER_NAME}`);
    report.facts["Ação manual"] = `rollback_to=${previous}`;
    return "deploy";
  }
  state.settled = true;
  const after = await smoke({ url: smokeUrl, expectVersion: previous, allowMissingVersion: true, retryForMs: RETRY.afterRollback });
  for (const line of formatSmoke(after)) log(line);
  report.step("smoke da versão anterior (autoconsistente)", after.outcome === "PASS", smokeDetail(after));
  return after.outcome === "PASS" ? "ok" : "smoke";
}

/** Saída de um rollback automático, conforme o que `rollbackTo` conseguiu. */
const ROLLBACK_OUTCOME = {
  ok: (why) => `ROLLBACK AUTOMÁTICO — ${why}; produção voltou à anterior`,
  smoke: (why) => `ROLLBACK FEITO, mas a anterior também falhou no smoke — ${why}; produção precisa de atenção`,
  deploy: (why) => `ROLLBACK FALHOU — ${why}; ação manual (ver resumo)`,
};

export async function runDeploy({
  wrangler,
  smoke: rawSmoke,
  log = console.log,
  smokeUrl,
  tag,
  message,
  drill = false,
  assetsDir = ASSETS_DIR,
  remoteHead = () => remoteMainHead(),
  state = createDeployState(),
}) {
  const smoke = guardSmoke(rawSmoke);
  const report = createReport(drill ? "deploy (drill de rollback)" : "deploy");
  state.report = report;
  const done = (exitCode, outcome) => ({ exitCode, outcome, report, summary: renderSummary(report, outcome) });
  const short = tag.slice(0, 7);
  report.facts["URL do smoke"] = smokeUrl;
  report.facts.Tag = tag;

  // 0. Só o HEAD da main vai ao ar: re-run de execução antiga não publica sha velho.
  let head = null;
  const headOk = await attempt(report, log, "HEAD da main (git ls-remote)", async () => {
    head = await remoteHead();
    return head;
  });
  if (!headOk) return done(EXIT.FAIL, "NÃO PUBLICADO — não deu para confirmar o HEAD da main");
  if (!head.startsWith(tag)) {
    report.facts["HEAD da main"] = head;
    return done(EXIT.OBSOLETO, `NÃO PUBLICADO (OBSOLETO) — ${short} não é mais o HEAD da main (${head.slice(0, 7)}): execução antiga ou superada; a do HEAD publica`);
  }

  // 1. Versão em 100 % hoje.
  let previous;
  const statusOk = await attempt(report, log, "deployments status", async () => {
    const status = await wrangler.status();
    const traffic = status.versions.map((v) => `${v.version_id}@${v.percentage}%`).join(", ");
    log(`deployment atual: ${traffic}`);
    const full = status.versions.filter((v) => v.percentage === 100);
    if (full.length !== 1 || status.versions.length > 2) throw new Error(`deployment atual dividida (${traffic}); resolva à mão antes de publicar`);
    previous = full[0].version_id;
    return `anterior ${previous}`;
  });
  if (!statusOk) return done(EXIT.FAIL, "NÃO PUBLICADO — deployment atual ilegível ou dividida");
  report.facts["Versão anterior"] = previous;
  state.previous = previous;

  // 2. Upload.
  let next;
  const uploaded = await attempt(report, log, "versions upload", async () => {
    next = await wrangler.upload({ tag, message });
    if (next === previous) throw new Error("o upload devolveu a versão que já está no ar");
    return `nova ${next}`;
  });
  if (!uploaded) return done(EXIT.FAIL, "NÃO PUBLICADO — upload falhou");
  report.facts["Versão nova"] = next;
  state.next = next;

  // 3. Nova a 0 %.
  const staged = await attempt(report, log, `versions deploy ${next}@0% ${previous}@100%`, () =>
    wrangler.deploy(
      [
        [next, 0],
        [previous, 100],
      ],
      `ci ${short}: smoke A a 0%`,
    ),
  );
  if (!staged) {
    // O comando pode ter falhado depois de aplicar; garantir o estado de partida.
    await attempt(report, log, `restaura ${previous}@100%`, () => wrangler.deploy([[previous, 100]], `ci ${short}: restaura`));
    return done(EXIT.FAIL, "NÃO PROMOVIDO — não deu para pôr a nova a 0 %");
  }

  // 4. Smoke A, com override e X-Torque-Version = nova.
  const a = await smoke({ url: smokeUrl, assetsDir, override: next, expectVersion: next, retryForMs: RETRY.smokeA });
  for (const line of formatSmoke(a)) log(line);
  report.step("smoke A (override, versão nova a 0 %)", a.outcome === "PASS", smokeDetail(a));
  if (a.outcome !== "PASS") {
    await attempt(report, log, `restaura ${previous}@100% (tira a nova da deployment)`, () => wrangler.deploy([[previous, 100]], `ci ${short}: smoke A ${a.outcome}`));
    return a.outcome === "BLOQUEADO"
      ? done(EXIT.BLOQUEADO, "NÃO PROMOVIDO — smoke A BLOQUEADO (desafio da zona; ver Bot Fight Mode)")
      : done(EXIT.FAIL, "NÃO PROMOVIDO — smoke A falhou; produção segue na anterior");
  }

  // 5–6. Promoção. Daqui até o B verde, qualquer falha — ou SIGINT/SIGTERM — desfaz.
  state.promoting = true;
  state.settled = false;
  const promoted =
    (await attempt(report, log, `versions deploy ${next}@100%`, () => wrangler.deploy([[next, 100]], `ci ${short}: promove`))) &&
    (await attempt(report, log, "triggers deploy", () => wrangler.triggers()));
  const rollback = (label) => rollbackTo(previous, { wrangler, smoke, log, report, smokeUrl, label, state });
  if (!promoted) return done(EXIT.FAIL, ROLLBACK_OUTCOME[await rollback(`ci ${short}: rollback (promoção falhou)`)]("a promoção falhou"));

  // 7. Smoke B, sem override: espera X-Torque-Version = nova, e só então avalia.
  const b = await smoke({ url: smokeUrl, assetsDir, expectVersion: next, retryForMs: RETRY.smokeB });
  for (const line of formatSmoke(b)) log(line);
  report.step("smoke B (sem override, versão nova a 100 %)", b.outcome === "PASS", smokeDetail(b));

  if (b.outcome === "BLOQUEADO") {
    // O A já provou a versão (X-Torque-Version); um desafio da zona não é defeito dela.
    state.settled = true;
    return done(EXIT.BLOQUEADO, "PROMOVIDO, mas smoke B BLOQUEADO (desafio da zona) — conferir à mão");
  }
  if (b.outcome === "FAIL") return done(EXIT.FAIL, ROLLBACK_OUTCOME[await rollback(`ci ${short}: rollback (smoke B)`)]("smoke B falhou"));
  if (drill) {
    log("drill: smoke B verde; forçando o rollback automático");
    const back = await rollback(`ci ${short}: drill de rollback`);
    return back === "ok" ? done(EXIT.PASS, "DRILL OK — promovida, desfeita e a anterior conferida") : done(EXIT.FAIL, `DRILL FALHOU — ${ROLLBACK_OUTCOME[back]("drill")}`);
  }
  state.settled = true;
  return done(EXIT.PASS, "PROMOVIDO — smoke A e B verdes");
}

export async function runRollback({ wrangler, smoke: rawSmoke, log = console.log, smokeUrl, versionId, state = createDeployState() }) {
  const smoke = guardSmoke(rawSmoke);
  const report = createReport("rollback manual");
  state.report = report;
  const done = (exitCode, outcome) => ({ exitCode, outcome, report, summary: renderSummary(report, outcome) });
  report.facts["URL do smoke"] = smokeUrl;
  report.facts["Versão alvo"] = versionId;

  await attempt(report, log, "deployments status (antes)", async () => {
    const status = await wrangler.status();
    report.facts["Deployment antes"] = status.versions.map((v) => `${v.version_id}@${v.percentage}%`).join(", ");
  });
  const moved = await attempt(report, log, `versions deploy ${versionId}@100%`, () => wrangler.deploy([[versionId, 100]], "rollback manual (workflow_dispatch)"));
  if (!moved) return done(EXIT.FAIL, "ROLLBACK FALHOU — a versão alvo existe entre as 100 últimas?");

  // A alvo pode ser de antes do X-Torque-Version: ausente serve, outro id não.
  const result = await smoke({ url: smokeUrl, expectVersion: versionId, allowMissingVersion: true, retryForMs: RETRY.afterRollback });
  for (const line of formatSmoke(result)) log(line);
  report.step("smoke autoconsistente", result.outcome === "PASS", smokeDetail(result));
  if (result.outcome === "BLOQUEADO") return done(EXIT.BLOQUEADO, "ROLLBACK FEITO, smoke BLOQUEADO (desafio da zona)");
  return result.outcome === "PASS" ? done(EXIT.PASS, "ROLLBACK FEITO — smoke verde") : done(EXIT.FAIL, "ROLLBACK FEITO, mas o smoke falhou — produção precisa de atenção");
}

/**
 * SIGINT/SIGTERM (job cancelado, ou o `timeout-minutes` venceu): se há uma
 * versão promovida sem o B verde, mata o wrangler em voo e volta a anterior a
 * 100 % — dentro do prazo até o SIGKILL do runner. Um segundo sinal não
 * dispara outro rollback: devolve a mesma promessa, que fica em
 * `handler.pending` (o fluxo principal a espera em `completeRun`).
 * Antes do rollback, `progress(outcome)` grava um resumo provisório — um
 * SIGKILL no meio não deixa o Summary vazio. `finish(code, outcome)` grava o
 * resumo final e sai.
 */
export function createInterruptHandler({ state, wrangler, log, finish, progress = () => {}, killActive = killActiveWranglers }) {
  const handle = async (signal) => {
    const code = signal === "SIGINT" ? EXIT.SIGINT : EXIT.SIGTERM;
    killActive();
    if (!(state.promoting && !state.settled && state.previous)) {
      log(`${signal}: nada promovido sem prova; nada a desfazer`);
      return finish(code, `INTERROMPIDO (${signal}) — nada promovido sem prova`);
    }
    log(`${signal}: ${state.next} promovida sem smoke B verde; rollback para ${state.previous}`);
    progress(`INTERROMPIDO (${signal}) — rollback para ${state.previous} em andamento; se este resumo não mudar, rode o workflow com rollback_to=${state.previous}`);
    try {
      await wrangler.deploy([[state.previous, 100]], `ci: rollback (${signal})`, { timeoutMs: TIMEOUTS.interrupt });
      state.settled = true;
      state.report?.step(`rollback no ${signal}: versions deploy ${state.previous}@100%`, true);
      return finish(code, `INTERROMPIDO (${signal}) — ROLLBACK FEITO para ${state.previous}; confira com o smoke`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`ROLLBACK FALHOU no ${signal}: ${message}. Rode o workflow com rollback_to=${state.previous}`);
      state.report?.step(`rollback no ${signal}`, false, message);
      if (state.report) state.report.facts["Ação manual"] = `rollback_to=${state.previous}`;
      return finish(code, `INTERROMPIDO (${signal}) — ROLLBACK FALHOU; ação manual: rollback_to=${state.previous}`);
    }
  };
  const handler = (signal) => {
    if (!handler.pending) handler.pending = handle(signal);
    return handler.pending;
  };
  /** @type {Promise<unknown> | null} */
  handler.pending = null;
  return handler;
}

/**
 * O fim da execução, uma vez só: grava o resumo, imprime o resultado e sai.
 * Chamadas depois da primeira não fazem nada — o handler de sinal e o fluxo
 * principal podem chegar aqui quase juntos. `progress` grava o resumo sem sair.
 *
 * @param {{ state: { report: object | null }, summaryPath?: string, log: (line: string) => void,
 *   exit?: (code: number) => unknown, write?: (file: string, text: string) => unknown }} options
 */
export function createFinish({ state, summaryPath, log, exit = (code) => process.exit(code), write = (file, text) => fs.writeFileSync(file, text) }) {
  let finished = false;
  const progress = (outcome) => {
    if (summaryPath && state.report) write(summaryPath, renderSummary(state.report, outcome));
  };
  const finish = (exitCode, outcome) => {
    if (finished) return;
    finished = true;
    progress(outcome);
    log(`\n${outcome}`);
    exit(exitCode);
  };
  return { finish, progress };
}

/**
 * Fim do fluxo principal. Se um sinal chegou no meio, o handler está (ou
 * esteve) desfazendo a promoção: o resultado é dele, não o do fluxo — senão um
 * B que fecha PASS durante o rollback do sinal sairia como PROMOVIDO.
 */
export async function completeRun(result, { interrupt, finish }) {
  if (interrupt.pending) return interrupt.pending;
  return finish(result.exitCode, result.outcome);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export function parseCliArgs(argv) {
  let args;
  try {
    args = parseArgs(argv, { "smoke-url": "string", tag: "string", message: "string", drill: "boolean", "rollback-to": "string", summary: "string" });
  } catch (error) {
    throw new DeployUsageError(error.message);
  }
  if (!args["smoke-url"]) throw new DeployUsageError("--smoke-url é obrigatório");
  let smokeUrl;
  try {
    smokeUrl = parseSmokeUrl(args["smoke-url"]);
  } catch (error) {
    throw new DeployUsageError(error.message);
  }
  if (new URL(smokeUrl).protocol !== "https:") throw new DeployUsageError("--smoke-url de produção é https://");

  if (args["rollback-to"] !== undefined) {
    if (!UUID.test(args["rollback-to"])) throw new DeployUsageError(`--rollback-to precisa ser um version id (UUID): ${args["rollback-to"]}`);
    if (args.drill || args.tag || args.message) throw new DeployUsageError("--rollback-to não combina com --drill, --tag ou --message");
    return { mode: "rollback", smokeUrl, versionId: args["rollback-to"], summary: args.summary };
  }

  if (!TAG.test(args.tag ?? "")) throw new DeployUsageError(`--tag precisa ser o sha do commit (7–40 hex): ${args.tag}`);
  if (!MESSAGE.test(args.message ?? "")) throw new DeployUsageError("--message: 1–100 caracteres ASCII imprimíveis");
  const drill = args.drill === true;
  if (drill && !isWorkersDev(smokeUrl)) throw new DeployUsageError("--drill só com --smoke-url em *.workers.dev (antes do corte)");
  return { mode: "deploy", smokeUrl, tag: args.tag, message: args.message, drill, summary: args.summary };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  assertCredentials(process.env);
  const wrangler = createWrangler();
  const log = (line) => console.log(line);
  const smoke = (opts) => smokeUntilPass(opts, { retryForMs: opts.retryForMs, log });
  const state = createDeployState();

  const { finish, progress } = createFinish({ state, summaryPath: options.summary, log });
  const onSignal = createInterruptHandler({ state, wrangler, log, finish, progress });
  // `on`, não `once`: o segundo sinal (SIGTERM depois do SIGINT) cai no handler, que o ignora, em vez de matar o rollback.
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  let result;
  if (options.mode === "rollback") {
    result = await runRollback({ wrangler, smoke, log, smokeUrl: options.smokeUrl, versionId: options.versionId, state });
  } else {
    assertAssetsReady();
    result = await runDeploy({ wrangler, smoke, log, smokeUrl: options.smokeUrl, tag: options.tag, message: options.message, drill: options.drill, state });
  }
  await completeRun(result, { interrupt: onSignal, finish });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(error instanceof DeployUsageError ? EXIT.USAGE : EXIT.FAIL);
  });
}
