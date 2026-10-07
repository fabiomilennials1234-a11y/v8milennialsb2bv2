// @vitest-environment node
/**
 * Invariantes de segurança dos dois workflows do front na Cloudflare. O
 * repositório é PÚBLICO: log e artifact são públicos, e um workflow que deploya
 * produção com segredo é o alvo mais óbvio do repo. Cada regra aqui fecha uma
 * porta conhecida — trocar uma delas tem de ser decisão, não descuido de PR.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { RETRY, TIMEOUTS } from "../../../scripts/cloudflare/ci-deploy.mjs";
import { LIMITS } from "../../../scripts/cloudflare/smoke.mjs";

const DIR = path.resolve(__dirname, "../../../.github/workflows");
const files = { deploy: "deploy-front-cloudflare.yml", verify: "verify-front-cloudflare.yml" } as const;
const text = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.readFileSync(path.join(DIR, f), "utf8")])) as Record<keyof typeof files, string>;
type Step = { uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string>; name?: string; if?: string };
type Job = {
  if?: string;
  needs?: string;
  environment?: string | { name: string; url: string };
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  "timeout-minutes"?: number;
  steps: Step[];
};
type Input = { type?: string };
type Workflow = {
  on: {
    push?: { branches: string[] };
    pull_request?: { branches: string[]; paths: string[] };
    workflow_dispatch?: { inputs: Record<string, Input> };
  };
  permissions?: Record<string, string>;
  concurrency?: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, Job>;
};
const wf = Object.fromEntries(Object.entries(text).map(([k, t]) => [k, parse(t) as Workflow])) as Record<keyof typeof files, Workflow>;

const jobs = (w: Workflow): [string, Job][] => Object.entries(w.jobs);
const steps = (w: Workflow): Step[] => jobs(w).flatMap(([, job]) => job.steps);

describe.each(Object.keys(files) as (keyof typeof files)[])("%s", (key) => {
  const w = wf[key];

  it("permissions: {} no topo e só contents: read em cada job", () => {
    expect(w.permissions).toEqual({});
    for (const [name, job] of jobs(w)) expect(job.permissions, name).toEqual({ contents: "read" });
  });

  it("todo `uses:` é actions/* fixado por SHA completo, com a tag em comentário", () => {
    const uses = [...text[key].matchAll(/uses:\s*(\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, ref, comment] of uses) {
      expect(ref, ref).toMatch(/^actions\/[a-z-]+@[0-9a-f]{40}$/);
      expect(comment, ref).toMatch(/# v\d+\.\d+\.\d+/);
    }
    // Só actions/* — nem cloudflare/wrangler-action: o wrangler é o do cloudflare/package-lock.json.
    expect(uses.map(([, ref]) => ref).filter((ref) => !ref!.startsWith("actions/"))).toEqual([]);
  });

  it("checkout sem credencial persistida", () => {
    for (const step of steps(w).filter((s) => s.uses?.startsWith("actions/checkout@"))) {
      expect(step.with?.["persist-credentials"]).toBe(false);
    }
  });

  it("Node 24", () => {
    for (const step of steps(w).filter((s) => s.uses?.startsWith("actions/setup-node@"))) expect(step.with?.["node-version"]).toBe("24");
  });

  it("nada que ecoe segredo: sem set -x, sem despejar o ambiente, sem ${{ }} dentro de run", () => {
    for (const step of steps(w)) {
      if (!step.run) continue;
      expect(step.run, step.name).not.toMatch(/set\s+-[a-z]*x|\bprintenv\b|^\s*env\s*$|\benv\s*\||\bexport\s+-p\b|\bdeclare\s+-p\b/m);
      // Valor de input/variável só por env: interpolação no script é injeção de shell.
      expect(step.run, step.name).not.toContain("${{");
    }
  });

  it("npm ci sempre sem scripts de instalação", () => {
    for (const step of steps(w)) {
      for (const line of (step.run ?? "").split("\n").filter((l) => /\bnpm ci\b/.test(l))) expect(line).toContain("--ignore-scripts");
    }
  });
});

describe("deploy-front-cloudflare.yml", () => {
  const w = wf.deploy;
  const job = (name: string) => w.jobs[name];
  const jobSteps = (name: string): Step[] => job(name).steps;

  it("dispara no push da main (sem filtro de caminho) e no workflow_dispatch com rollback_to e drill", () => {
    expect(w.on.push).toEqual({ branches: ["main"] });
    expect(Object.keys(w.on.workflow_dispatch!.inputs).sort()).toEqual(["drill", "rollback_to"]);
    expect(w.on.workflow_dispatch!.inputs.drill!.type).toBe("boolean");
    expect(w.on).not.toHaveProperty("pull_request");
    expect(w.on).not.toHaveProperty("pull_request_target");
  });

  it("um deploy por vez, sem cancelar o que está no meio", () => {
    expect(w.concurrency).toEqual({ group: "front-cloudflare-production", "cancel-in-progress": false });
  });

  it("dois environments: build em front-build, deploy e rollback em front-production", () => {
    expect(job("build").environment).toBe("front-build");
    for (const name of ["deploy", "rollback"]) expect(job(name).environment).toEqual({ name: "front-production", url: "${{ vars.CF_SMOKE_URL }}" });
    expect(job("deploy").needs).toBe("build");
  });

  it("todo job só roda na main; build pula com rollback_to; rollback só com rollback_to", () => {
    for (const [name, j] of jobs(w)) expect(j.if, name).toContain("github.ref == 'refs/heads/main'");
    expect(job("build").if).toContain("inputs.rollback_to == ''");
    expect(job("rollback").if).toContain("inputs.rollback_to != ''");
    expect(job("build")["timeout-minutes"]).toBe(20);
  });

  it("prazos com folga sobre o pior caso do ci-deploy (a conta está no comentário do workflow)", () => {
    // Pior caso, das constantes do código: cada smoke dura no máximo retry + o teto de uma rodada.
    const smoke = (retry: number) => retry + LIMITS.attemptMs;
    const worstMs =
      TIMEOUTS.git + TIMEOUTS.status + TIMEOUTS.upload + TIMEOUTS.deploy + smoke(RETRY.smokeA) + TIMEOUTS.deploy + TIMEOUTS.triggers + smoke(RETRY.smokeB) + TIMEOUTS.deploy + smoke(RETRY.afterRollback);
    expect(worstMs / 1000).toBe(1275); // o número do comentário do workflow
    const worstSeconds = worstMs / 1000;
    const deployStep = jobSteps("deploy").find((s) => s.env?.CLOUDFLARE_API_TOKEN) as Step & { "timeout-minutes": number };
    expect(deployStep["timeout-minutes"] * 60).toBeGreaterThan(worstSeconds);
    expect(job("deploy")["timeout-minutes"]!).toBeGreaterThan(deployStep["timeout-minutes"] + 2);
    const rollbackStep = jobSteps("rollback").find((s) => s.env?.CLOUDFLARE_API_TOKEN) as Step & { "timeout-minutes": number };
    expect(rollbackStep["timeout-minutes"] * 60 * 1000).toBeGreaterThan(TIMEOUTS.status + TIMEOUTS.deploy + smoke(RETRY.afterRollback));
    expect(job("rollback")["timeout-minutes"]!).toBeGreaterThan(rollbackStep["timeout-minutes"]);
  });

  it("o node recebe os sinais do runner direto (exec), para o rollback do SIGINT/SIGTERM", () => {
    for (const name of ["deploy", "rollback"]) {
      const step = jobSteps(name).find((s) => s.env?.CLOUDFLARE_API_TOKEN)!;
      expect(step.run, name).toMatch(/^\s*exec node scripts\/cloudflare\/ci-deploy\.mjs /m);
    }
  });

  it("sem cache de pacote nos jobs com segredo (cache da main é gravável por outro workflow)", () => {
    for (const step of steps(w).filter((s) => s.uses?.startsWith("actions/setup-node@"))) {
      expect(step.with?.["package-manager-cache"]).toBe(false);
      expect(step.with).not.toHaveProperty("cache");
    }
  });

  it("CLOUDFLARE_API_TOKEN só no step do ci-deploy, de deploy e de rollback", () => {
    for (const [name, j] of jobs(w)) {
      expect(j.env ?? {}, name).not.toHaveProperty("CLOUDFLARE_API_TOKEN");
      const holders = (j.steps as Step[]).filter((s) => s.env && "CLOUDFLARE_API_TOKEN" in s.env);
      if (name === "build") {
        expect(holders).toHaveLength(0);
        continue;
      }
      expect(holders, name).toHaveLength(1);
      expect(holders[0]!.env!.CLOUDFLARE_API_TOKEN).toBe("${{ secrets.CLOUDFLARE_API_TOKEN }}");
      expect(holders[0]!.run).toContain("node scripts/cloudflare/ci-deploy.mjs");
      expect(holders[0]!.env!.WRANGLER_SEND_METRICS).toBe("false");
      expect(holders[0]!.env!.CLOUDFLARE_ACCOUNT_ID).toBe("${{ vars.CLOUDFLARE_ACCOUNT_ID }}");
    }
    expect(text.deploy.match(/secrets\.CLOUDFLARE_API_TOKEN/g)).toHaveLength(2);
  });

  it("os únicos segredos do arquivo são o da Cloudflare e o do Sentry", () => {
    const secrets = new Set([...text.deploy.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]));
    expect([...secrets].sort()).toEqual(["CLOUDFLARE_API_TOKEN", "SENTRY_AUTH_TOKEN"]);
    expect(text.deploy).not.toMatch(/secrets\.GITHUB_TOKEN/);
  });

  it("o token do job (github.token) só chega ao step do ci-deploy do deploy — para o ls-remote num repo privado", () => {
    expect(text.deploy.match(/github\.token/g)).toHaveLength(1);
    for (const [name, j] of jobs(w)) {
      expect(j.env ?? {}, name).not.toHaveProperty("GITHUB_TOKEN");
      const holders = j.steps.filter((s) => s.env && "GITHUB_TOKEN" in s.env);
      if (name !== "deploy") {
        expect(holders, name).toHaveLength(0);
        continue;
      }
      expect(holders).toHaveLength(1);
      expect(holders[0]!.env!.GITHUB_TOKEN).toBe("${{ github.token }}");
      expect(holders[0]!.run).toContain("node scripts/cloudflare/ci-deploy.mjs");
      // O job continua só com leitura: o token não escreve nada no repositório.
      expect(j.permissions).toEqual({ contents: "read" });
    }
  });

  it("build: check-env antes do npm ci; cf:prepare depois da build", () => {
    const runs = jobSteps("build").map((s) => s.run ?? s.uses ?? "");
    const at = (needle: string) => runs.findIndex((r) => r.includes(needle));
    expect(at("npm run cf:ci:check-env")).toBeGreaterThan(-1);
    expect(at("npm run cf:ci:check-env")).toBeLessThan(at("npm ci"));
    expect(at("npm ci")).toBeLessThan(at("npm run build:dual"));
    expect(at("npm run build:dual")).toBeLessThan(at("npm run cf:prepare -- --from dist"));
    expect(at("npm run cf:prepare -- --from dist")).toBeLessThan(at("actions/upload-artifact@"));
  });

  it("artifact = cloudflare/.assets (com os ocultos, 3 dias, erro se vazio) — nunca dist/", () => {
    const uploads = steps(w).filter((s) => s.uses?.startsWith("actions/upload-artifact@"));
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.with).toEqual({
      name: "front-assets-${{ github.sha }}",
      path: "cloudflare/.assets",
      "include-hidden-files": true,
      "if-no-files-found": "error",
      "retention-days": 3,
      overwrite: true,
    });
    expect(text.deploy).not.toMatch(/path:\s*\.?\/?dist\b/);
    const downloads = jobSteps("deploy").filter((s) => s.uses?.startsWith("actions/download-artifact@"));
    expect(downloads[0]!.with).toEqual({ name: "front-assets-${{ github.sha }}", path: "cloudflare/.assets" });
  });

  it("inputs do dispatch chegam ao script só por env", () => {
    const deployStep = jobSteps("deploy").find((s) => s.env?.CLOUDFLARE_API_TOKEN)!;
    expect(deployStep.env!.DRILL).toBe("${{ inputs.drill }}");
    const rollbackStep = jobSteps("rollback").find((s) => s.env?.CLOUDFLARE_API_TOKEN)!;
    expect(rollbackStep.env!.ROLLBACK_TO).toBe("${{ inputs.rollback_to }}");
    expect(rollbackStep.run).toContain('--rollback-to "$ROLLBACK_TO"');
  });

  it("resumo vai para o $GITHUB_STEP_SUMMARY mesmo quando o deploy falha", () => {
    for (const name of ["deploy", "rollback"]) {
      const summary = jobSteps(name).at(-1)!;
      expect(summary.if).toBe("always()");
      expect(summary.run).toContain("$GITHUB_STEP_SUMMARY");
    }
  });
});

describe("verify-front-cloudflare.yml", () => {
  const w = wf.verify;

  it("só pull_request (nunca pull_request_target), filtrado pelos caminhos do front", () => {
    expect(Object.keys(w.on)).toEqual(["pull_request"]);
    const paths: string[] = w.on.pull_request!.paths;
    for (const p of ["src/**", "classic/**", "cloudflare/**", "scripts/cloudflare/**", "tests/unit/cloudflare/**", "Dockerfile", "package-lock.json", ".github/workflows/deploy-front-cloudflare.yml"]) {
      expect(paths, p).toContain(p);
    }
  });

  it("sem segredo nenhum", () => {
    expect(text.verify).not.toMatch(/secrets\./);
    expect(text.verify).not.toMatch(/environment:/);
  });

  it("build:dual, cf:prepare, cf:typecheck, wrangler types --check e os testes", () => {
    const runs = steps(w)
      .map((s) => s.run ?? "")
      .join("\n");
    for (const cmd of ["npm run build:dual", "npm run cf:prepare -- --from dist", "npm run cf:typecheck", "npm --prefix cloudflare run types -- --check", "npx vitest run tests/unit/cloudflare"]) {
      expect(runs, cmd).toContain(cmd);
    }
  });
});
