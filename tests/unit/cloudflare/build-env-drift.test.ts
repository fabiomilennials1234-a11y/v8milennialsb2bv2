// @vitest-environment node
/**
 * Enquanto o EasyPanel builda produção pelo Dockerfile, o job `build` do
 * deploy-front-cloudflare.yml tem de buildar com o MESMO ambiente: mesmos
 * nomes, mesmos defaults. Senão o bundle da Cloudflare deixa de ser o do
 * EasyPanel byte a byte — e a paridade, que é a prova do corte, quebra sem
 * ninguém ter mudado código.
 *
 * Detalhe que custa caro: o Dockerfile DEFINE toda VITE_* do bloco ENV, vazia
 * se não vier valor. `import.meta.env.X` vazia vira `""` no bundle; ausente
 * vira `void 0`. Por isso o workflow define todas, inclusive as sem valor.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(__dirname, "../../..");
const DOCKERFILE = path.join(ROOT, "Dockerfile");
const WORKFLOW = path.join(ROOT, ".github/workflows/deploy-front-cloudflare.yml");

/** ARG e ENV do estágio builder (do `FROM … AS builder` ao próximo FROM). */
function builderStage() {
  const text = fs.readFileSync(DOCKERFILE, "utf8");
  const start = text.indexOf("AS builder");
  const end = text.indexOf("\nFROM ", start);
  expect(start, "estágio builder").toBeGreaterThan(0);
  const stage = text.slice(start, end);
  const args = new Map<string, string | null>();
  for (const m of stage.matchAll(/^ARG ([A-Z0-9_]+)(?:=(.*))?$/gm)) args.set(m[1]!, m[2] ?? null);
  const envBlock = stage.slice(stage.indexOf("\nENV "), stage.indexOf("\nRUN npm run build:dual"));
  const envNames = [...envBlock.matchAll(/([A-Z0-9_]+)=\$\{\1\}/g)].map((m) => m[1]!);
  return { args, envNames, runsBuildDual: stage.includes("RUN npm run build:dual") };
}

/** ARG sem default: a variável do environment (vazia se não existir, como o ENV do Dockerfile). */
const FROM_VARS = (name: string) => `\${{ vars.${name} }}`;

const workflow = parse(fs.readFileSync(WORKFLOW, "utf8"));
const buildEnv: Record<string, string> = workflow.jobs.build.env;

describe.skipIf(!fs.existsSync(DOCKERFILE))("Dockerfile × deploy-front-cloudflare.yml (job build)", () => {
  const { args, envNames, runsBuildDual } = builderStage();

  it("o Dockerfile ainda builda com build:dual e declara as variáveis de sempre", () => {
    expect(runsBuildDual).toBe(true);
    expect(args.size).toBeGreaterThanOrEqual(18);
    expect(envNames.length).toBeGreaterThanOrEqual(14);
  });

  it("ARG com default → o MESMO valor, literal (o EasyPanel não sobrescreve nenhum)", () => {
    const withDefault = [...args].filter(([, value]) => value !== null);
    expect(withDefault.map(([name]) => name).sort()).toEqual(["SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_URL", "VITE_CHAT_BUBBLE", "VITE_CHAT_ONDA_2B", "VITE_SENTRY_DSN", "VITE_UI_SWITCH"]);
    for (const [name, dockerDefault] of withDefault) expect(buildEnv[name], name).toBe(dockerDefault);
  });

  it("ARG sem default (menos o token e a versão) → a variável do environment, vazia se não existir", () => {
    for (const [name, dockerDefault] of args) {
      if (dockerDefault !== null || name === "SENTRY_AUTH_TOKEN" || name === "VITE_APP_VERSION") continue;
      expect(buildEnv[name], name).toBe(FROM_VARS(name));
    }
  });

  it("nada a mais: toda VITE_*/SENTRY_* do job existe no Dockerfile", () => {
    for (const name of Object.keys(buildEnv)) expect(args.has(name), name).toBe(true);
  });

  it("toda VITE_* do ENV do Dockerfile está DEFINIDA no job (vazia ≠ ausente no bundle)", () => {
    for (const name of envNames) expect(buildEnv, name).toHaveProperty(name);
  });

  it("VITE_APP_VERSION vazia na fase de prova (prod mostra 0.0.0; a troca para sha- é outro PR)", () => {
    expect(args.get("VITE_APP_VERSION")).toBeNull();
    expect(buildEnv.VITE_APP_VERSION).toBe("");
  });
});

describe("SENTRY_AUTH_TOKEN só no step da build", () => {
  it("nunca no env do job; no step que roda build:dual, vindo de secret", () => {
    expect(buildEnv).not.toHaveProperty("SENTRY_AUTH_TOKEN");
    const steps: { name?: string; run?: string; env?: Record<string, string> }[] = workflow.jobs.build.steps;
    const withToken = steps.filter((step) => step.env && "SENTRY_AUTH_TOKEN" in step.env);
    expect(withToken).toHaveLength(1);
    expect(withToken[0]!.env!.SENTRY_AUTH_TOKEN).toBe("${{ secrets.SENTRY_AUTH_TOKEN }}");
    expect(withToken[0]!.run).toContain("npm run build:dual");
    expect(withToken[0]!.run).toContain("cf:ci:check-env -- --sentry-token");
  });

  it("e em nenhum outro lugar do arquivo", () => {
    const text = fs.readFileSync(WORKFLOW, "utf8");
    expect(text.match(/secrets\.SENTRY_AUTH_TOKEN/g)).toHaveLength(1);
  });
});
