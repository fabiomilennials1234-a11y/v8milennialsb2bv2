// @vitest-environment node
/**
 * O ci-deploy decide o que vai ao ar em produção. As duas garantias que valem
 * o pipeline inteiro ficam presas aqui, com wrangler e smoke dublados:
 *   - smoke A falhou → a versão nova NUNCA chega a receber tráfego;
 *   - qualquer falha depois da promoção → rollback automático para a anterior.
 * E o adaptador do wrangler: os argumentos exatos de cada comando (versão
 * 4.147.0, conferidos em cloudflare/node_modules/wrangler/wrangler-dist/cli.js)
 * e a leitura do id pelo ND-JSON, não pelo texto do terminal. E o que vai para
 * o log PÚBLICO: nada de e-mail, conta ou permissão de token.
 */
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeployUsageError,
  EXIT,
  MAIN_REF,
  MAIN_REPO_URL,
  RETRY,
  TIMEOUTS,
  WRANGLER_CLI,
  WranglerError,
  assertAssetsReady,
  assertCredentials,
  completeRun,
  createDeployState,
  createFinish,
  createInterruptHandler,
  createWrangler,
  filterWranglerOutput,
  remoteMainHead,
  spawnWrangler,
  parseCliArgs,
  parseDeploymentStatus,
  parseUploadOutput,
  renderSummary,
  runDeploy,
  runRollback,
} from "../../../scripts/cloudflare/ci-deploy.mjs";

const PREV = "11111111-1111-4111-8111-111111111111";
const NEXT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const SHA = "86412c0c0a1b2c3d4e5f60718293a4b5c6d7e8f9";
const URL_DEV = "https://torque-front.torquecrm.workers.dev";

type Outcome = "PASS" | "FAIL" | "BLOQUEADO";
type Call = [string, ...unknown[]];

/** Wrangler dublado: registra cada operação; `fail` faz a operação lançar. */
function fakeWrangler({ versions = [{ version_id: PREV, percentage: 100 }], fail = {} as Record<string, (traffic?: [string, number][]) => boolean> } = {}) {
  const calls: Call[] = [];
  const maybeFail = (op: string, traffic?: [string, number][]) => {
    if (fail[op]?.(traffic)) throw new WranglerError(`wrangler ${op} saiu com 1`);
  };
  return {
    calls,
    traffic: () => calls.filter(([op]) => op === "deploy").map(([, t]) => (t as [string, number][]).map(([id, pct]) => `${id.slice(0, 4)}@${pct}`).join(" ")),
    wrangler: {
      async status() {
        calls.push(["status"]);
        maybeFail("status");
        return { versions };
      },
      async upload(args: { tag: string; message: string }) {
        calls.push(["upload", args]);
        maybeFail("upload");
        return NEXT;
      },
      async deploy(traffic: [string, number][], message: string) {
        calls.push(["deploy", traffic, message]);
        maybeFail("deploy", traffic);
      },
      async triggers() {
        calls.push(["triggers"]);
        maybeFail("triggers");
      },
    },
  };
}

/** Smoke dublado: devolve os resultados na ordem; registra as opções de cada chamada. */
function fakeSmoke(...outcomes: Outcome[]) {
  const calls: { url: string; assetsDir?: string; override?: string; expectVersion?: string; allowMissingVersion?: boolean; retryForMs?: number }[] = [];
  const smoke = async (options: (typeof calls)[number]) => {
    calls.push(options);
    const outcome = outcomes.shift() ?? "PASS";
    return { outcome, attempts: 1, blockedBy: [], checks: [{ name: "GET /", problems: outcome === "PASS" ? [] : [`problema ${outcome}`] }] };
  };
  return { smoke, calls };
}

const logs: string[] = [];
const log = (line: string) => logs.push(line);
beforeEach(() => {
  logs.length = 0;
});

/** `remoteHead` dublado: o HEAD da main é o próprio SHA (nenhum teste vai à rede). */
const deploy = (wrangler: ReturnType<typeof fakeWrangler>, smoke: ReturnType<typeof fakeSmoke>, extra: object = {}) =>
  runDeploy({
    wrangler: wrangler.wrangler,
    smoke: smoke.smoke,
    log,
    smokeUrl: URL_DEV,
    tag: SHA,
    message: "GitHub Actions run 1.1",
    assetsDir: "/tmp/assets",
    remoteHead: async () => SHA,
    ...extra,
  });

describe("runDeploy — caminho feliz", () => {
  it("0 % → smoke A com override → 100 % → triggers → smoke B; sem rollback", async () => {
    const w = fakeWrangler();
    const s = fakeSmoke("PASS", "PASS");
    const result = await deploy(w, s);
    expect(result.exitCode).toBe(0);
    expect(result.outcome).toMatch(/^PROMOVIDO/);
    expect(w.calls.map(([op]) => op)).toEqual(["status", "upload", "deploy", "deploy", "triggers"]);
    expect(w.traffic()).toEqual(["2222@0 1111@100", "2222@100"]);
    expect(w.calls[1]).toEqual(["upload", { tag: SHA, message: "GitHub Actions run 1.1" }]);
    // A e B exigem X-Torque-Version = nova: o A com override, o B esperando a propagação.
    expect(s.calls).toEqual([
      { url: URL_DEV, assetsDir: "/tmp/assets", override: NEXT, expectVersion: NEXT, retryForMs: RETRY.smokeA },
      { url: URL_DEV, assetsDir: "/tmp/assets", expectVersion: NEXT, retryForMs: RETRY.smokeB },
    ]);
  });
});

describe("runDeploy — smoke A falhou: a nova nunca recebe tráfego", () => {
  for (const [outcome, exitCode] of [
    ["FAIL", 1],
    ["BLOQUEADO", 3],
  ] as const) {
    it(`A ${outcome} → sem promoção, deployment de volta a anterior@100 %, saída ${exitCode}`, async () => {
      const w = fakeWrangler();
      const s = fakeSmoke(outcome);
      const result = await deploy(w, s);
      expect(result.exitCode).toBe(exitCode);
      expect(result.outcome).toMatch(/^NÃO PROMOVIDO/);
      // Nenhuma operação dá à versão nova porcentagem acima de zero.
      for (const [op, traffic] of w.calls) {
        if (op !== "deploy") continue;
        for (const [id, pct] of traffic as [string, number][]) if (id === NEXT) expect(pct).toBe(0);
      }
      expect(w.traffic()).toEqual(["2222@0 1111@100", "1111@100"]);
      expect(w.calls.map(([op]) => op)).not.toContain("triggers");
      expect(s.calls).toHaveLength(1);
    });
  }

  it("upload falhou → nada de deploy", async () => {
    const w = fakeWrangler({ fail: { upload: () => true } });
    const result = await deploy(w, fakeSmoke());
    expect(result.exitCode).toBe(1);
    expect(w.calls.map(([op]) => op)).toEqual(["status", "upload"]);
  });

  it("não deu para pôr a nova a 0 % → garante anterior@100 % e para", async () => {
    const w = fakeWrangler({ fail: { deploy: (t) => t!.length === 2 } });
    const s = fakeSmoke();
    const result = await deploy(w, s);
    expect(result.exitCode).toBe(1);
    expect(w.traffic()).toEqual(["2222@0 1111@100", "1111@100"]);
    expect(s.calls).toHaveLength(0);
  });

  it("deployment dividida entre versões (alguém no meio de algo) → não publica", async () => {
    const w = fakeWrangler({
      versions: [
        { version_id: PREV, percentage: 60 },
        { version_id: OTHER, percentage: 40 },
      ],
    });
    const result = await deploy(w, fakeSmoke());
    expect(result.exitCode).toBe(1);
    expect(w.calls.map(([op]) => op)).toEqual(["status"]);
    expect(result.summary).toMatch(/dividida/);
  });

  it("sobra de execução anterior (anterior@100 % + outra@0 %): a anterior é a de 100 %", async () => {
    const w = fakeWrangler({
      versions: [
        { version_id: PREV, percentage: 100 },
        { version_id: OTHER, percentage: 0 },
      ],
    });
    expect((await deploy(w, fakeSmoke("PASS", "PASS"))).exitCode).toBe(0);
    expect(w.traffic()[0]).toBe("2222@0 1111@100");
  });
});

describe("runDeploy — falha depois da promoção: rollback automático", () => {
  it("smoke B FAIL → versions deploy anterior@100 %, smoke autoconsistente da anterior, saída 1", async () => {
    const w = fakeWrangler();
    const s = fakeSmoke("PASS", "FAIL", "PASS");
    const result = await deploy(w, s);
    expect(result.exitCode).toBe(1);
    expect(result.outcome).toMatch(/^ROLLBACK AUTOMÁTICO/);
    expect(w.traffic()).toEqual(["2222@0 1111@100", "2222@100", "1111@100"]);
    // O smoke depois do rollback é autoconsistente: o artefato local é da versão desfeita.
    // A anterior pode ser de antes do header: ausente serve, outra versão não.
    expect(s.calls[2]).toEqual({ url: URL_DEV, expectVersion: PREV, allowMissingVersion: true, retryForMs: RETRY.afterRollback });
  });

  it("exceção no smoke B (não só FAIL) também desfaz: a nova não fica em 100 % sem prova", async () => {
    const w = fakeWrangler();
    let call = 0;
    const smoke = async () => {
      call += 1;
      if (call === 2) throw new Error("ENOENT cloudflare/.assets/index.html");
      return { outcome: "PASS", attempts: 1, blockedBy: [], checks: [] };
    };
    const result = await runDeploy({ wrangler: w.wrangler, smoke, log, smokeUrl: URL_DEV, tag: SHA, message: "run 1", assetsDir: "/tmp/assets", remoteHead: async () => SHA });
    expect(result.exitCode).toBe(1);
    expect(w.traffic()).toEqual(["2222@0 1111@100", "2222@100", "1111@100"]);
    expect(result.summary).toMatch(/exceção: ENOENT/);
  });

  it("smoke B BLOQUEADO → sem rollback (o A já provou a versão), saída 3", async () => {
    const w = fakeWrangler();
    const result = await deploy(w, fakeSmoke("PASS", "BLOQUEADO"));
    expect(result.exitCode).toBe(3);
    expect(w.traffic()).toEqual(["2222@0 1111@100", "2222@100"]);
  });

  it("promoção a 100 % falhou → rollback", async () => {
    const w = fakeWrangler({ fail: { deploy: (t) => t!.length === 1 && t![0]![0] === NEXT } });
    const result = await deploy(w, fakeSmoke("PASS", "PASS"));
    expect(result.exitCode).toBe(1);
    expect(w.traffic()).toEqual(["2222@0 1111@100", "2222@100", "1111@100"]);
    expect(w.calls.map(([op]) => op)).not.toContain("triggers");
  });

  it("triggers deploy falhou → rollback", async () => {
    const w = fakeWrangler({ fail: { triggers: () => true } });
    const result = await deploy(w, fakeSmoke("PASS", "PASS"));
    expect(result.exitCode).toBe(1);
    expect(w.traffic().at(-1)).toBe("1111@100");
  });

  it("o próprio rollback falhou → saída 1 e a ação manual escrita no resumo", async () => {
    const w = fakeWrangler({ fail: { deploy: (t) => t!.length === 1 && t![0]![0] === PREV } });
    const result = await deploy(w, fakeSmoke("PASS", "FAIL"));
    expect(result.exitCode).toBe(1);
    expect(result.outcome).toMatch(/^ROLLBACK FALHOU/);
    expect(result.summary).toContain(`rollback_to=${PREV}`);
    expect(logs.join("\n")).toContain(`wrangler rollback ${PREV}`);
  });

  it("anterior também falha no smoke depois do rollback → continua vermelho e o resumo diz", async () => {
    const result = await deploy(fakeWrangler(), fakeSmoke("PASS", "FAIL", "FAIL"));
    expect(result.exitCode).toBe(1);
    expect(result.outcome).toMatch(/^ROLLBACK FEITO, mas a anterior também falhou/);
  });
});

describe("runDeploy — drill", () => {
  it("B verde → força o rollback; saída 0 se a anterior passar no smoke", async () => {
    const w = fakeWrangler();
    const result = await deploy(w, fakeSmoke("PASS", "PASS", "PASS"), { drill: true });
    expect(result.exitCode).toBe(0);
    expect(result.outcome).toMatch(/^DRILL OK/);
    expect(w.traffic()).toEqual(["2222@0 1111@100", "2222@100", "1111@100"]);
  });

  it("drill com a anterior falhando depois do rollback → vermelho", async () => {
    expect((await deploy(fakeWrangler(), fakeSmoke("PASS", "PASS", "FAIL"), { drill: true })).exitCode).toBe(1);
  });
});

describe("runDeploy — resumo", () => {
  it("leva versões, tag e o resultado de cada etapa; nada do ambiente", async () => {
    process.env.CLOUDFLARE_API_TOKEN = "cf-token-SENTINELA";
    try {
      const result = await deploy(fakeWrangler(), fakeSmoke("PASS", "FAIL", "PASS"));
      expect(result.summary).toContain(PREV);
      expect(result.summary).toContain(NEXT);
      expect(result.summary).toContain(SHA);
      expect(result.summary).toMatch(/smoke B .*\*\*FALHOU\*\*/);
      expect(result.summary + logs.join("\n")).not.toContain("SENTINELA");
    } finally {
      delete process.env.CLOUDFLARE_API_TOKEN;
    }
  });

  it("renderSummary escapa | e quebra de linha vindos de mensagem de erro", () => {
    const md = renderSummary({ kind: "deploy", facts: { x: "a|b" }, steps: [{ name: "s", ok: false, detail: "linha1\nlinha2 | x" }] }, "R");
    expect(md).not.toMatch(/linha1\n/);
    expect(md.split("\n").filter((l) => l.startsWith("| s |"))).toHaveLength(1);
  });
});

describe("runRollback", () => {
  it("versions deploy <id>@100 % + smoke autoconsistente", async () => {
    const w = fakeWrangler();
    const s = fakeSmoke("PASS");
    const result = await runRollback({ wrangler: w.wrangler, smoke: s.smoke, log, smokeUrl: URL_DEV, versionId: OTHER });
    expect(result.exitCode).toBe(0);
    expect(w.traffic()).toEqual(["3333@100"]);
    expect(s.calls).toEqual([{ url: URL_DEV, expectVersion: OTHER, allowMissingVersion: true, retryForMs: RETRY.afterRollback }]);
  });

  it("smoke vermelho depois do rollback → saída 1; deploy recusado → saída 1 sem smoke", async () => {
    expect((await runRollback({ wrangler: fakeWrangler().wrangler, smoke: fakeSmoke("FAIL").smoke, log, smokeUrl: URL_DEV, versionId: OTHER })).exitCode).toBe(1);
    const s = fakeSmoke();
    const refused = await runRollback({ wrangler: fakeWrangler({ fail: { deploy: () => true } }).wrangler, smoke: s.smoke, log, smokeUrl: URL_DEV, versionId: OTHER });
    expect(refused.exitCode).toBe(1);
    expect(s.calls).toHaveLength(0);
  });
});

describe("createWrangler — argumentos do wrangler 4.147.0", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ci-deploy-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const recorder = (respond: (args: string[], opts?: { outputFile?: string }) => { code: number; stdout?: string }) => {
    const calls: { args: string[]; opts?: { outputFile?: string } }[] = [];
    const exec = async (args: string[], opts?: { outputFile?: string }) => {
      calls.push({ args, opts });
      return { stdout: "", ...respond(args, opts) };
    };
    return { calls, wrangler: createWrangler({ exec, tmpDir: tmp }) };
  };

  it("status: deployments status --json --name torque-front, JSON mesmo com aviso em volta", async () => {
    const { calls, wrangler } = recorder(() => ({ code: 0, stdout: `aviso qualquer\n${JSON.stringify({ versions: [{ version_id: PREV, percentage: 100 }] })}\n` }));
    expect((await wrangler.status()).versions[0].version_id).toBe(PREV);
    expect(calls[0]!.args).toEqual(["deployments", "status", "--json", "--name", "torque-front"]);
  });

  it("upload: versions upload --tag --message; id do ND-JSON de WRANGLER_OUTPUT_FILE_PATH; arquivo apagado depois", async () => {
    const { calls, wrangler } = recorder((_args, opts) => {
      fs.writeFileSync(
        opts!.outputFile!,
        `${JSON.stringify({ type: "wrangler-session", version: 1 })}\n${JSON.stringify({ type: "version-upload", version: 1, version_id: NEXT })}\n`,
      );
      return { code: 0, stdout: "Worker Version ID: 99999999-9999-4999-8999-999999999999" };
    });
    expect(await wrangler.upload({ tag: SHA, message: "run 1" })).toBe(NEXT);
    expect(calls[0]!.args).toEqual(["versions", "upload", "--tag", SHA, "--message", "run 1"]);
    expect(calls[0]!.opts!.outputFile!.startsWith(tmp)).toBe(true);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it("upload sem registro version-upload (ex.: abortado) → erro, não id vazio", async () => {
    const { wrangler } = recorder(() => ({ code: 0 }));
    await expect(wrangler.upload({ tag: SHA, message: "run 1" })).rejects.toThrow(/version_id/);
  });

  it("deploy: versions deploy <id>@<pct>% … --yes --message --name; tráfego validado antes", async () => {
    const { calls, wrangler } = recorder(() => ({ code: 0 }));
    await wrangler.deploy(
      [
        [NEXT, 0],
        [PREV, 100],
      ],
      "ci 86412c0: smoke A a 0%",
    );
    expect(calls[0]!.args).toEqual(["versions", "deploy", `${NEXT}@0%`, `${PREV}@100%`, "--yes", "--message", "ci 86412c0: smoke A a 0%", "--name", "torque-front"]);
    await expect(wrangler.deploy([[NEXT, 50]], "x")).rejects.toThrow(/somar 100/);
    await expect(wrangler.deploy([["--dry-run", 100]] as [string, number][], "x")).rejects.toThrow(/tráfego inválido/);
    expect(calls).toHaveLength(1);
  });

  it("triggers: triggers deploy (workers.dev e preview URLs vêm do wrangler.jsonc)", async () => {
    const { calls, wrangler } = recorder(() => ({ code: 0 }));
    await wrangler.triggers();
    expect(calls[0]!.args).toEqual(["triggers", "deploy"]);
  });

  it("saída diferente de zero → WranglerError", async () => {
    const { wrangler } = recorder(() => ({ code: 1 }));
    await expect(wrangler.triggers()).rejects.toBeInstanceOf(WranglerError);
  });

  it("parsers recusam o que não entendem", () => {
    expect(() => parseDeploymentStatus("nada")).toThrow(WranglerError);
    expect(() => parseDeploymentStatus('{"id":"x"}')).toThrow(/versions/);
    expect(() => parseUploadOutput(`${JSON.stringify({ type: "version-upload", version_id: null })}\n`)).toThrow(WranglerError);
    expect(parseUploadOutput(`${JSON.stringify({ type: "version-upload", version_id: PREV })}\n${JSON.stringify({ type: "version-upload", version_id: NEXT })}\n`)).toBe(NEXT);
  });
});

describe("parseCliArgs", () => {
  const base = ["--smoke-url", URL_DEV, "--tag", SHA, "--message", "GitHub Actions run 1.1"];

  it("deploy normal e drill no workers.dev", () => {
    expect(parseCliArgs(base)).toMatchObject({ mode: "deploy", smokeUrl: URL_DEV, tag: SHA, drill: false });
    expect(parseCliArgs([...base, "--drill"])).toMatchObject({ drill: true });
  });

  it("drill no domínio real é recusado", () => {
    expect(() => parseCliArgs(["--smoke-url", "https://torquecrm.com.br", "--tag", SHA, "--message", "x", "--drill"])).toThrow(/drill só com/);
  });

  it("recusa tag, mensagem, URL e id fora do formato", () => {
    for (const argv of [
      ["--smoke-url", URL_DEV, "--tag", "main", "--message", "x"],
      ["--smoke-url", URL_DEV, "--tag", SHA, "--message", "a\nb"],
      ["--smoke-url", URL_DEV, "--tag", SHA, "--message", "x".repeat(101)],
      ["--smoke-url", "http://localhost:8787", "--tag", SHA, "--message", "x"],
      ["--smoke-url", `${URL_DEV}/leads`, "--tag", SHA, "--message", "x"],
      ["--tag", SHA, "--message", "x"],
      ["--smoke-url", URL_DEV, "--rollback-to", "$(rm -rf /)"],
      ["--smoke-url", URL_DEV, "--rollback-to", PREV, "--drill"],
      ["--smoke-url", URL_DEV, "--nao-existe"],
    ]) {
      expect(() => parseCliArgs(argv), argv.join(" ")).toThrow(DeployUsageError);
    }
  });

  it("rollback", () => {
    expect(parseCliArgs(["--smoke-url", URL_DEV, "--rollback-to", PREV])).toEqual({ mode: "rollback", smokeUrl: URL_DEV, versionId: PREV, summary: undefined });
  });
});

describe("assertAssetsReady", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ci-assets-"));
    for (const name of ["index.html", "index.classic.html", "sw.js", "sw.classic.js", "_headers", ".assetsignore"]) fs.writeFileSync(path.join(tmp, name), "x");
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("aceita a pasta do cf:prepare; recusa incompleta ou com source map", () => {
    expect(() => assertAssetsReady(tmp)).not.toThrow();
    fs.mkdirSync(path.join(tmp, "assets"));
    fs.writeFileSync(path.join(tmp, "assets", "index-A.js.map"), "{}");
    expect(() => assertAssetsReady(tmp)).toThrow(/source map/);
    fs.rmSync(path.join(tmp, "assets"), { recursive: true });
    fs.rmSync(path.join(tmp, "_headers"));
    expect(() => assertAssetsReady(tmp)).toThrow(/_headers/);
  });
});

describe("assertCredentials", () => {
  const ACCOUNT = "90f317b67b6e1bbba9752c63d99241b8";

  it("sem CLOUDFLARE_API_TOKEN falha cedo, dizendo onde criar — e sem repetir valor nenhum", () => {
    expect(() => assertCredentials({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT })).toThrow(/CLOUDFLARE_API_TOKEN ausente.*front-production/s);
    expect(() => assertCredentials({ CLOUDFLARE_API_TOKEN: " ", CLOUDFLARE_ACCOUNT_ID: ACCOUNT })).toThrow(DeployUsageError);
  });

  it("account id ausente ou fora do formato", () => {
    expect(() => assertCredentials({ CLOUDFLARE_API_TOKEN: "t" })).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
    expect(() => assertCredentials({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "conta" })).toThrow(/32 hex/);
  });

  it("com os dois, passa", () => {
    expect(() => assertCredentials({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: ACCOUNT })).not.toThrow();
  });

  it("CLI: sem token sai 2 antes de chamar o wrangler", () => {
    const script = path.resolve(__dirname, "../../../scripts/cloudflare/ci-deploy.mjs");
    const result = spawnSync(process.execPath, [script, "--smoke-url", URL_DEV, "--tag", SHA, "--message", "run 1"], {
      env: { PATH: process.env.PATH ?? "", CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/CLOUDFLARE_API_TOKEN ausente/);
    expect(result.stdout).toBe("");
  });
});

describe("runDeploy — só o HEAD da main vai ao ar (re-run de execução antiga)", () => {
  it("tag ≠ HEAD da main → OBSOLETO (saída 4), sem nenhuma chamada ao wrangler", async () => {
    const w = fakeWrangler();
    const s = fakeSmoke();
    const head = "f".repeat(40);
    const result = await deploy(w, s, { remoteHead: async () => head });
    expect(result.exitCode).toBe(EXIT.OBSOLETO);
    expect(EXIT.OBSOLETO).toBe(4);
    expect(result.outcome).toMatch(/OBSOLETO.*86412c0.*ffffff/);
    expect(w.calls).toEqual([]);
    expect(s.calls).toEqual([]);
  });

  it("sem como confirmar o HEAD (rede, GitHub fora) → não publica", async () => {
    const w = fakeWrangler();
    const result = await deploy(w, fakeSmoke(), {
      remoteHead: async () => {
        throw new Error("git ls-remote saiu com 128");
      },
    });
    expect(result.exitCode).toBe(EXIT.FAIL);
    expect(result.outcome).toMatch(/não deu para confirmar o HEAD/);
    expect(w.calls).toEqual([]);
  });

  it("tag curta vale como prefixo do HEAD", async () => {
    const result = await deploy(fakeWrangler(), fakeSmoke("PASS", "PASS"), { tag: SHA.slice(0, 9) });
    expect(result.exitCode).toBe(0);
  });
});

/** Processo filho falso: o teste escreve no stdout/stderr e fecha com o código. */
type FakeChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: (signal?: string) => boolean; killedWith?: string };
function fakeSpawn(script: (child: FakeChild) => void) {
  const calls: { cmd: string; args: string[]; opts: { cwd?: string; env: Record<string, string | undefined>; stdio: unknown } }[] = [];
  const spawnImpl = (cmd: string, args: string[], opts: (typeof calls)[number]["opts"]) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter() as FakeChild;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal?: string) => {
      child.killedWith = signal;
      setImmediate(() => child.emit("close", null, signal));
      return true;
    };
    setImmediate(() => script(child));
    return child;
  };
  return { spawnImpl, calls };
}
const finishWith = (child: FakeChild, code: number) => setImmediate(() => child.emit("close", code));

/** Saída real de um erro de autenticação do wrangler 4.147.0 com token em variável (cli.js 363433-363455 → whoami 351240-351370). */
const AUTH_ERROR_STDERR = [
  "\x1b[31m✘ \x1b[41;31m[\x1b[41;97mERROR\x1b[41;31m]\x1b[0m \x1b[1mA request to the Cloudflare API (/accounts/90f317b67b6e1bbba9752c63d99241b8/workers/services/torque-front) failed.\x1b[0m",
  "",
  "  Authentication error [code: 10000]",
  "",
  "",
].join("\n");
const AUTH_ERROR_STDOUT = [
  "\x1b[33m📎 It looks like you are authenticating Wrangler via a custom API token set in an environment variable.",
  "Please ensure it has the correct permissions for this operation.\x1b[39m",
  "",
  "Getting User settings...",
  "👋 You are logged in with an User API Token, associated with the email cto.pessoal@torquecrm.com.br.",
  "ℹ️  The API Token is read from the CLOUDFLARE_API_TOKEN environment variable.",
  "┌───────────────────────────────────────┬──────────────────────────────────┐",
  "│ Account Name                          │ Account ID                       │",
  "├───────────────────────────────────────┼──────────────────────────────────┤",
  "│ Torquecrm.suporte@gmail.com's Account │ 90f317b67b6e1bbba9752c63d99241b8 │",
  "└───────────────────────────────────────┴──────────────────────────────────┘",
  "🔓 To see token permissions visit https://dash.cloudflare.com/profile/api-tokens",
  "",
].join("\n");
const SECRETS_IN_OUTPUT = ["cto.pessoal@torquecrm.com.br", "torquecrm.suporte@gmail.com", "Torquecrm.suporte", "90f317b67b6e1bbba9752c63d99241b8", "Account Name", "User API Token", "Token Permissions", "api-tokens"];

describe("log público: saída do wrangler (B1)", () => {
  it("deployments status --json: o stdout (com author_email) nunca chega ao log, nem pelo process.stdout", async () => {
    const statusJson = JSON.stringify({ id: "d", author_email: "torquecrm.suporte@gmail.com", versions: [{ version_id: PREV, percentage: 100 }] }, null, 2);
    const writes: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write");
    try {
      const { spawnImpl } = fakeSpawn((child) => {
        child.stdout.write(statusJson);
        finishWith(child, 0);
      });
      const wrangler = createWrangler({ exec: (args, opts) => spawnWrangler(args, opts, { spawnImpl, write: (t: string) => writes.push(t) }) });
      expect((await wrangler.status()).versions[0].version_id).toBe(PREV);
      expect(writes).toEqual([]);
      // E o caminho padrão (sem `write` injetado) também não escreve nada.
      const { spawnImpl: spawn2 } = fakeSpawn((child) => {
        child.stdout.write(statusJson);
        finishWith(child, 0);
      });
      await spawnWrangler(["deployments", "status", "--json"], { echo: false }, { spawnImpl: spawn2 });
      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(written).not.toContain("torquecrm.suporte@gmail.com");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("status que falha: o JSON continua fora, e a mensagem de parse não cita o conteúdo", async () => {
    const writes: string[] = [];
    const { spawnImpl } = fakeSpawn((child) => {
      child.stdout.write('{"author_email":"torquecrm.suporte@gmail.com",');
      finishWith(child, 1);
    });
    const result = await spawnWrangler(["deployments", "status", "--json"], { echo: false }, { spawnImpl, write: (t: string) => writes.push(t) });
    expect(result.code).toBe(1);
    expect(writes.join("")).not.toContain("torquecrm.suporte");
    expect(() => parseDeploymentStatus('{"author_email":"torquecrm.suporte@gmail.com", x}')).toThrow(/ilegível$/);
  });

  it("erro de autenticação: o [ERROR] fica; whoami (e-mail, conta, ids, permissões) sai inteiro", async () => {
    const writes: string[] = [];
    const { spawnImpl } = fakeSpawn((child) => {
      child.stderr.write(AUTH_ERROR_STDERR);
      child.stdout.write(AUTH_ERROR_STDOUT);
      finishWith(child, 1);
    });
    const result = await spawnWrangler(["versions", "upload"], {}, { spawnImpl, write: (t: string) => writes.push(t) });
    expect(result.code).toBe(1);
    const out = writes.join("");
    expect(out).toContain("[ERROR] A request to the Cloudflare API (/accounts/<id>/workers/services/torque-front) failed.");
    expect(out).toContain("Authentication error [code: 10000]");
    expect(out).toMatch(/linha\(s\) fora do log público, inclusive a saída de whoami/);
    for (const secret of SECRETS_IN_OUTPUT) expect(out, secret).not.toContain(secret);
  });

  it("filterWranglerOutput: lista de permissão — progresso conhecido passa, o desconhecido é contado e some", () => {
    const text = [
      " ⛅️ wrangler 4.147.0",
      "Total Upload: 16.34 KiB / gzip: 5.16 KiB",
      "Worker Startup Time: 12 ms",
      "Your Worker has access to the following bindings:",
      "env.API_UPSTREAM (\"https://jsjsmuncfkbsbzqzqhfq.supabase...\")      Environment Variable",
      "Uploaded torque-front (3.21 sec)",
      `Worker Version ID: ${NEXT}`,
      "╰  SUCCESS  Deployed torque-front version 22222222-2222-4222-8222-222222222222 at 100% (1.23 sec)",
      "Author: alguem@exemplo.com",
      "linha que ninguém previu",
    ].join("\n");
    const { lines, omitted, whoami } = filterWranglerOutput(text);
    expect(lines).toEqual([
      "Total Upload: 16.34 KiB / gzip: 5.16 KiB",
      "Worker Startup Time: 12 ms",
      "Your Worker has access to the following bindings:",
      'env.API_UPSTREAM ("https://jsjsmuncfkbsbzqzqhfq.supabase...")      Environment Variable',
      "Uploaded torque-front (3.21 sec)",
      `Worker Version ID: ${NEXT}`,
      "╰  SUCCESS  Deployed torque-front version 22222222-2222-4222-8222-222222222222 at 100% (1.23 sec)",
    ]);
    expect(omitted).toBe(3);
    expect(whoami).toBe(false);
  });

  it("filterWranglerOutput: e-mail e id de conta dentro de um [ERROR] são mascarados", () => {
    const { lines } = filterWranglerOutput("✘ [ERROR] falhou para fulano@empresa.com.br na conta 90f317b67b6e1bbba9752c63d99241b8\n  detalhe de beltrano@x.io\n");
    expect(lines).toEqual(["✘ [ERROR] falhou para <email> na conta <id>", "  detalhe de <email>"]);
  });
});

describe("prazos e interrupção (C3)", () => {
  it("wrangler pendurado: morto com SIGKILL no prazo, código 124 — e o adaptador transforma em erro", async () => {
    let child: FakeChild | undefined;
    const { spawnImpl, calls } = fakeSpawn((c) => {
      child = c;
    });
    const result = await spawnWrangler(["versions", "deploy"], { timeoutMs: 30 }, { spawnImpl, write: () => {} });
    expect(result).toMatchObject({ code: 124, timedOut: true });
    expect(child!.killedWith).toBe("SIGKILL");
    // O CLI direto (não o bin/wrangler.js, que deixaria o filho órfão no kill).
    expect(calls[0]!.args.slice(0, 2)).toEqual(["--no-warnings", WRANGLER_CLI]);
    const wrangler = createWrangler({ exec: async () => ({ code: 124, stdout: "", timedOut: true }) });
    await expect(wrangler.triggers()).rejects.toThrow(/não terminou em 60 s/);
  });

  it("cada comando tem prazo; o do upload é o maior", async () => {
    const seen: Record<string, number> = {};
    const wrangler = createWrangler({
      exec: async (args, opts) => {
        seen[args.slice(0, 2).join(" ")] = opts.timeoutMs ?? -1;
        if (opts.outputFile) fs.writeFileSync(opts.outputFile, `${JSON.stringify({ type: "version-upload", version_id: NEXT })}\n`);
        return { code: 0, stdout: JSON.stringify({ versions: [] }) };
      },
    });
    await wrangler.status();
    await wrangler.upload({ tag: SHA, message: "m" });
    await wrangler.deploy([[NEXT, 100]], "m");
    await wrangler.triggers();
    expect(seen).toEqual({ "deployments status": TIMEOUTS.status, "versions upload": TIMEOUTS.upload, "versions deploy": TIMEOUTS.deploy, "triggers deploy": TIMEOUTS.triggers });
  });

  it("estado do deploy: promovida sem prova só entre a promoção e o B verde", async () => {
    const state = createDeployState();
    const snapshots: object[] = [];
    const smoke = async (options: { override?: string }) => {
      snapshots.push({ promoting: state.promoting, settled: state.settled, previous: state.previous, next: state.next, override: options.override });
      return { outcome: "PASS", attempts: 1, blockedBy: [], checks: [] };
    };
    const result = await runDeploy({ wrangler: fakeWrangler().wrangler, smoke, log, smokeUrl: URL_DEV, tag: SHA, message: "m", assetsDir: "/tmp/a", remoteHead: async () => SHA, state });
    expect(result.exitCode).toBe(0);
    expect(snapshots).toEqual([
      { promoting: false, settled: true, previous: PREV, next: NEXT, override: NEXT },
      { promoting: true, settled: false, previous: PREV, next: NEXT, override: undefined },
    ]);
    expect(state.settled).toBe(true);
  });

  it("depois de um rollback automático o estado fica resolvido (um sinal não desfaz de novo)", async () => {
    const state = createDeployState();
    await runDeploy({ wrangler: fakeWrangler().wrangler, smoke: fakeSmoke("PASS", "FAIL", "PASS").smoke, log, smokeUrl: URL_DEV, tag: SHA, message: "m", assetsDir: "/tmp/a", remoteHead: async () => SHA, state });
    expect(state).toMatchObject({ promoting: true, settled: true });
  });

  describe("createInterruptHandler", () => {
    const promotedState = () => ({ ...createDeployState(), previous: PREV, next: NEXT, promoting: true, settled: false });

    it("promovida sem B verde: mata o wrangler em voo, volta a anterior a 100 % no prazo do SIGKILL, sai 143", async () => {
      const w = fakeWrangler();
      const deploySpy = vi.spyOn(w.wrangler, "deploy");
      const killActive = vi.fn();
      const finish = vi.fn();
      const handler = createInterruptHandler({ state: promotedState(), wrangler: w.wrangler, log, finish, killActive });
      await handler("SIGTERM");
      expect(killActive).toHaveBeenCalledTimes(1);
      expect(deploySpy).toHaveBeenCalledWith([[PREV, 100]], "ci: rollback (SIGTERM)", { timeoutMs: TIMEOUTS.interrupt });
      expect(TIMEOUTS.interrupt).toBeLessThan(10_000);
      expect(finish).toHaveBeenCalledWith(143, expect.stringMatching(/ROLLBACK FEITO/));
    });

    it("segundo sinal (SIGTERM depois do SIGINT) não dispara outro rollback", async () => {
      const w = fakeWrangler();
      const finish = vi.fn();
      const handler = createInterruptHandler({ state: promotedState(), wrangler: w.wrangler, log, finish, killActive: () => {} });
      await Promise.all([handler("SIGINT"), handler("SIGTERM")]);
      expect(w.traffic()).toEqual(["1111@100"]);
      expect(finish).toHaveBeenCalledTimes(1);
      expect(finish).toHaveBeenCalledWith(130, expect.any(String));
    });

    it("nada promovido (antes da promoção, ou B já verde): não mexe em nada", async () => {
      for (const state of [{ ...createDeployState(), previous: PREV, next: NEXT }, { ...promotedState(), settled: true }]) {
        const w = fakeWrangler();
        const finish = vi.fn();
        await createInterruptHandler({ state, wrangler: w.wrangler, log, finish, killActive: () => {} })("SIGINT");
        expect(w.calls).toEqual([]);
        expect(finish).toHaveBeenCalledWith(130, expect.stringMatching(/nada a desfazer|nada promovido/));
      }
    });

    it("rollback falhou no sinal: resumo com a ação manual", async () => {
      const w = fakeWrangler({ fail: { deploy: () => true } });
      const state = { ...promotedState(), report: { facts: {} as Record<string, string>, step: vi.fn() } };
      const finish = vi.fn();
      await createInterruptHandler({ state, wrangler: w.wrangler, log, finish, killActive: () => {} })("SIGTERM");
      expect(finish).toHaveBeenCalledWith(143, `INTERROMPIDO (SIGTERM) — ROLLBACK FALHOU; ação manual: rollback_to=${PREV}`);
      expect(state.report.facts["Ação manual"]).toBe(`rollback_to=${PREV}`);
    });
  });
});

describe("remoteMainHead (git ls-remote do repositório público)", () => {
  const SHA_MAIN = "9641c07f25765d74d0a091b5582b6d84b44f236b";
  const answering = () =>
    fakeSpawn((child) => {
      child.stdout.write(`${SHA_MAIN}\t${MAIN_REF}\n`);
      finishWith(child, 0);
    });

  it("repositório público (sem GITHUB_TOKEN): lê o sha sem credencial nenhuma, nem a do ambiente", async () => {
    process.env.CLOUDFLARE_API_TOKEN = "cf_SENTINELA";
    try {
      const { spawnImpl, calls } = answering();
      expect(await remoteMainHead({ spawnImpl, token: "" })).toBe(SHA_MAIN);
      expect(calls[0]!.cmd).toBe("git");
      expect(calls[0]!.args).toEqual(["-c", "credential.helper=", "ls-remote", "--exit-code", MAIN_REPO_URL, MAIN_REF]);
      expect(MAIN_REPO_URL).toBe("https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2");
      const env = calls[0]!.opts.env;
      expect(Object.keys(env).sort()).toEqual(["GIT_CEILING_DIRECTORIES", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_TERMINAL_PROMPT", "PATH"]);
      expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    } finally {
      delete process.env.CLOUDFLARE_API_TOKEN;
    }
  });

  it("repositório privado (GITHUB_TOKEN do job): header só para github.com, por variável de ambiente do git — nunca no argv", async () => {
    process.env.GITHUB_TOKEN = "ghs_SENTINELA_do_job";
    process.env.CLOUDFLARE_API_TOKEN = "cf_SENTINELA";
    try {
      const { spawnImpl, calls } = answering();
      expect(await remoteMainHead({ spawnImpl })).toBe(SHA_MAIN);
      const { args, opts } = calls[0]!;
      const env = opts.env;
      expect(env.GIT_CONFIG_COUNT).toBe("1");
      expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
      const [scheme, encoded] = env.GIT_CONFIG_VALUE_0!.replace(/^AUTHORIZATION: /, "").split(" ");
      expect(scheme).toBe("basic");
      expect(Buffer.from(encoded!, "base64").toString()).toBe("x-access-token:ghs_SENTINELA_do_job");
      // Nem o token nem a forma codificada no argv (visível no `ps`).
      expect(args.join(" ")).not.toContain("SENTINELA");
      expect(args.join(" ")).not.toContain(encoded);
      // E nada mais do ambiente do job vai junto.
      expect(Object.keys(env).sort()).toEqual([
        "GIT_CEILING_DIRECTORIES",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_KEY_0",
        "GIT_CONFIG_NOSYSTEM",
        "GIT_CONFIG_VALUE_0",
        "GIT_TERMINAL_PROMPT",
        "PATH",
      ]);
      // O stderr do git (onde ele poderia ecoar o pedido) é descartado.
      expect(opts.stdio).toEqual(["ignore", "pipe", "ignore"]);
    } finally {
      delete process.env.GITHUB_TOKEN;
      delete process.env.CLOUDFLARE_API_TOKEN;
    }
  });

  describe("fora de qualquer repositório (insteadOf no .git/config local não redireciona)", () => {
    let root: string;
    let fakeSha: string;
    const git = (cwd: string, ...args: string[]) =>
      spawnSync("git", args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull } });
    // Uma URL que nunca resolve (RFC 6761): sem o redirecionamento, o ls-remote falha sem sair da máquina.
    const URL_INVALIDA = "https://repo.example.invalid/fabio/v8";

    beforeEach(() => {
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ls-remote-repo-")));
      // Remoto falso, local: o que o insteadOf malicioso entregaria.
      const remote = path.join(root, "falso.git");
      git(root, "init", "-q", "--bare", "-b", "main", remote);
      const work = path.join(root, "work");
      git(root, "init", "-q", "-b", "main", work);
      git(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
      git(work, "push", "-q", remote, "main");
      fakeSha = git(work, "rev-parse", "HEAD").stdout.trim();
      // O checkout "envenenado": .git/config local manda a URL esperada para o remoto falso.
      git(work, "config", `url.file://${remote}.insteadOf`, URL_INVALIDA);
      fs.mkdirSync(path.join(work, "sub"));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    /** spawn de verdade, com o cwd do checkout como padrão — o que o processo herdaria. */
    const spawnFrom = (cwd: string) => (cmd: string, args: string[], opts: object) => spawn(cmd, args, { cwd, ...opts });

    it("cwd do processo dentro do checkout: o ls-remote não usa o insteadOf local", async () => {
      const work = path.join(root, "work");
      await expect(remoteMainHead({ spawnImpl: spawnFrom(work), url: URL_INVALIDA, token: "", timeoutMs: 10_000 })).rejects.toThrow(/sem o sha/);
      // Controle: o mesmo git, rodado no checkout, cai no remoto falso — o perigo é real.
      expect(git(work, "ls-remote", URL_INVALIDA, "refs/heads/main").stdout).toContain(fakeSha);
    });

    it("tmpdir dentro de um repositório: GIT_CEILING_DIRECTORIES impede o git de subir até ele", async () => {
      const tmpBase = path.join(root, "work", "sub");
      await expect(remoteMainHead({ spawnImpl: spawn, url: URL_INVALIDA, token: "", tmpBase, timeoutMs: 10_000 })).rejects.toThrow(/sem o sha/);
      expect(fs.readdirSync(tmpBase)).toEqual([]); // o diretório de trabalho do git é apagado
    });
  });

  it("o wrangler nunca recebe o GITHUB_TOKEN", async () => {
    process.env.GITHUB_TOKEN = "ghs_SENTINELA_do_job";
    try {
      const { spawnImpl, calls } = fakeSpawn((child) => finishWith(child, 0));
      await spawnWrangler(["triggers", "deploy"], {}, { spawnImpl, write: () => {} });
      expect(calls[0]!.opts.env).not.toHaveProperty("GITHUB_TOKEN");
    } finally {
      delete process.env.GITHUB_TOKEN;
    }
  });

  it("saída sem o sha, ou código ≠ 0 → erro", async () => {
    const empty = fakeSpawn((child) => finishWith(child, 2));
    await expect(remoteMainHead({ spawnImpl: empty.spawnImpl })).rejects.toThrow(/saiu com 2/);
    const garbage = fakeSpawn((child) => {
      child.stdout.write("abc\trefs/heads/main\n");
      finishWith(child, 0);
    });
    await expect(remoteMainHead({ spawnImpl: garbage.spawnImpl })).rejects.toThrow(/sem o sha/);
  });
});

describe("fim da execução: sinal × fluxo principal (NB1, NB2)", () => {
  /** Wrangler cujo rollback do sinal só termina quando o teste solta. */
  function slowRollbackWrangler() {
    const base = fakeWrangler();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deploy = async (traffic: [string, number][], message: string, options?: { timeoutMs?: number }) => {
      if (options?.timeoutMs === TIMEOUTS.interrupt) await gate;
      return base.wrangler.deploy(traffic, message);
    };
    return { ...base, wrangler: { ...base.wrangler, deploy }, release: () => release() };
  }

  function harness() {
    const exits: number[] = [];
    const writes: string[] = [];
    const state = createDeployState();
    const { finish, progress } = createFinish({ state, summaryPath: "/resumo.md", log, exit: (code) => exits.push(code), write: (_file, text) => writes.push(text) });
    return { exits, writes, state, finish, progress };
  }

  it("createFinish: só a primeira chamada vale", () => {
    const h = harness();
    h.state.report = { kind: "deploy", facts: {}, steps: [], step() {} } as never;
    h.finish(143, "INTERROMPIDO");
    h.finish(0, "PROMOVIDO");
    expect(h.exits).toEqual([143]);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toContain("INTERROMPIDO");
  });

  it("SIGINT durante o B, e o B fecha PASS antes do rollback do sinal acabar: o fluxo espera, e o resumo é ROLLBACK FEITO, não PROMOVIDO", async () => {
    const h = harness();
    const w = slowRollbackWrangler();
    const handler = createInterruptHandler({ state: h.state, wrangler: w.wrangler, log, finish: h.finish, progress: h.progress, killActive: () => {} });
    const smoke = async (options: { override?: string }) => {
      if (!options.override) void handler("SIGINT"); // o sinal cai no meio do B
      return { outcome: "PASS", attempts: 1, blockedBy: [], checks: [] };
    };
    const result = await runDeploy({ wrangler: w.wrangler, smoke, log, smokeUrl: URL_DEV, tag: SHA, message: "m", assetsDir: "/tmp/a", remoteHead: async () => SHA, state: h.state });
    expect(result.outcome).toMatch(/^PROMOVIDO/);

    const done = completeRun(result, { interrupt: handler, finish: h.finish });
    await new Promise((r) => setImmediate(r));
    expect(h.exits).toEqual([]); // não saiu como PROMOVIDO
    w.release();
    await done;
    expect(h.exits).toEqual([130]);
    expect(h.writes.at(-1)).toMatch(/ROLLBACK FEITO para 11111111/);
    expect(w.traffic().at(-1)).toBe("1111@100");
  });

  it("sem sinal, o fluxo principal finaliza com o próprio resultado", async () => {
    const h = harness();
    const handler = createInterruptHandler({ state: h.state, wrangler: fakeWrangler().wrangler, log, finish: h.finish, killActive: () => {} });
    await completeRun({ exitCode: 0, outcome: "PROMOVIDO — x" }, { interrupt: handler, finish: h.finish });
    expect(h.exits).toEqual([0]);
  });

  it("resumo provisório ANTES do rollback do sinal: um SIGKILL no meio deixa o rollback_to escrito", async () => {
    const h = harness();
    h.state.report = { kind: "deploy", facts: {}, steps: [], step() {} } as never;
    Object.assign(h.state, { previous: PREV, next: NEXT, promoting: true, settled: false });
    const neverEnds = { ...fakeWrangler().wrangler, deploy: () => new Promise<void>(() => {}) };
    const handler = createInterruptHandler({ state: h.state, wrangler: neverEnds, log, finish: h.finish, progress: h.progress, killActive: () => {} });
    void handler("SIGTERM");
    await new Promise((r) => setImmediate(r));
    // O rollback não terminou (o runner mataria aqui), e o resumo já diz o que fazer.
    expect(h.exits).toEqual([]);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toContain(`rollback para ${PREV} em andamento; se este resumo não mudar, rode o workflow com rollback_to=${PREV}`);
  });
});
