// @vitest-environment node
/**
 * O Vite builda feliz com variável faltando — troca por `undefined` e o front
 * quebra no navegador. E tudo que é VITE_* vai para o bundle público. O
 * check-build-env pega as duas coisas antes da build, sem nunca imprimir valor.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_BUILD_ENV, checkBuildEnv, checkSentryToken } from "../../../scripts/cloudflare/check-build-env.mjs";

const SCRIPT = path.resolve(__dirname, "../../../scripts/cloudflare/check-build-env.mjs");

const jwt = (payload: object) =>
  [{ alg: "HS256", typ: "JWT" }, payload].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".c2lnbmF0dXJh";

const ANON = jwt({ iss: "supabase", ref: "jsjsmuncfkbsbzqzqhfq", role: "anon" });
const OK = {
  VITE_SUPABASE_URL: "https://jsjsmuncfkbsbzqzqhfq.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: ANON,
  VITE_SUPABASE_PROJECT_ID: "jsjsmuncfkbsbzqzqhfq",
  VITE_META_APP_ID: "1576525010095010",
  VITE_META_WA_CONFIG_ID: "1545957446891341",
  VITE_INVITE_API_URL: "",
  VITE_UI_SWITCH: "true",
};

describe("checkBuildEnv", () => {
  it("ambiente completo e limpo: nenhum problema", () => {
    expect(checkBuildEnv(OK)).toEqual([]);
  });

  it.each(REQUIRED_BUILD_ENV)("%s ausente ou só espaço → problema com o nome", (name) => {
    expect(checkBuildEnv({ ...OK, [name]: undefined }).join()).toContain(name);
    expect(checkBuildEnv({ ...OK, [name]: "   " }).join()).toContain(name);
  });

  it("as obrigatórias são as que o bundle no ar usa com valor", () => {
    expect([...REQUIRED_BUILD_ENV].sort()).toEqual(["VITE_META_APP_ID", "VITE_META_WA_CONFIG_ID", "VITE_SUPABASE_PROJECT_ID", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL"]);
  });

  it("URL do Supabase: https, host <projeto>.supabase.co, sem caminho, e o mesmo projeto do PROJECT_ID", () => {
    expect(checkBuildEnv({ ...OK, VITE_SUPABASE_URL: "http://jsjsmuncfkbsbzqzqhfq.supabase.co" }).join()).toMatch(/https/);
    expect(checkBuildEnv({ ...OK, VITE_SUPABASE_URL: "https://jsjsmuncfkbsbzqzqhfq.supabase.co/rest/v1" }).join()).toMatch(/sem caminho/);
    expect(checkBuildEnv({ ...OK, VITE_SUPABASE_URL: "https://api.example.com" }).join()).toMatch(/supabase\.co/);
    expect(checkBuildEnv({ ...OK, VITE_SUPABASE_URL: "não é url" }).join()).toMatch(/não é uma URL/);
    expect(checkBuildEnv({ ...OK, VITE_SUPABASE_PROJECT_ID: "abcdefghijklmnopqrst" }).join()).toMatch(/não é o projeto/);
  });

  it("segredo numa VITE_* é recusado — e a mensagem não repete o valor", () => {
    const secret = "sb_secret_AAAAbbbbCCCCdddd1234";
    const serviceRole = jwt({ iss: "supabase", role: "service_role" });
    for (const [name, value] of [
      ["VITE_SUPABASE_PUBLISHABLE_KEY", secret],
      ["VITE_SUPABASE_PUBLISHABLE_KEY", serviceRole],
      // Montada em runtime: o literal inteiro é barrado pelo push protection do GitHub.
      ["VITE_QUALQUER", `sk_live_${"abcd1234".repeat(3)}`],
    ]) {
      const problems = checkBuildEnv({ ...OK, [name]: value }).join("\n");
      expect(problems, name).toContain(name);
      expect(problems, name).toMatch(/bundle público/);
      expect(problems).not.toContain(value);
    }
  });

  it("só olha VITE_*: o resto do ambiente do runner não é problema da build", () => {
    expect(checkBuildEnv({ ...OK, GITHUB_TOKEN: "ghp_" + "a".repeat(36) })).toEqual([]);
  });
});

describe("checkSentryToken", () => {
  it("token de organização (sntrys_) passa sem aviso", () => {
    expect(checkSentryToken({ SENTRY_AUTH_TOKEN: "sntrys_eyJpYXQiOjE3fQ_abc" })).toEqual({ errors: [], warnings: [] });
  });

  it("ausente NÃO bloqueia (mesma política do upload falho): só aviso", () => {
    for (const env of [{}, { SENTRY_AUTH_TOKEN: "" }, { SENTRY_AUTH_TOKEN: "  " }]) {
      const { errors, warnings } = checkSentryToken(env);
      expect(errors).toEqual([]);
      expect(warnings.join()).toMatch(/ausente.*SEM upload/);
    }
  });

  it("token PESSOAL (sntryu_) bloqueia, sem repetir o valor", () => {
    const personal = `sntryu_${"a".repeat(64)}`;
    const { errors } = checkSentryToken({ SENTRY_AUTH_TOKEN: personal });
    expect(errors.join()).toMatch(/PESSOAL/);
    expect(errors.join()).not.toContain(personal);
  });

  it("formato desconhecido: aviso, não bloqueio", () => {
    const { errors, warnings } = checkSentryToken({ SENTRY_AUTH_TOKEN: "invalido" });
    expect(errors).toEqual([]);
    expect(warnings.join()).toMatch(/formato/);
    expect(warnings.join()).not.toContain("invalido");
  });
});

describe("CLI", () => {
  // Ambiente mínimo: nada do ambiente de quem roda o teste vaza para o processo.
  const run = (env: Record<string, string>, args: string[] = []) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });

  it("sai 0 com o ambiente completo e 1 com variável faltando, citando o nome", () => {
    expect(run(OK).status).toBe(0);
    const missing = run({ ...OK, VITE_META_APP_ID: "" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("VITE_META_APP_ID");
  });

  it("--sentry-token: 0 sem token (com ::warning:: no Actions), 0 com token de organização, 1 com token pessoal; nunca imprime o token", () => {
    const absent = run({ GITHUB_ACTIONS: "true" }, ["--sentry-token"]);
    expect(absent.status).toBe(0);
    expect(absent.stdout).toMatch(/^::warning::SENTRY_AUTH_TOKEN ausente/m);
    const token = "sntrys_eyJpYXQiOjE3fQ_segredo";
    const ok = run({ SENTRY_AUTH_TOKEN: token }, ["--sentry-token"]);
    expect(ok.status).toBe(0);
    expect(ok.stdout + ok.stderr).not.toContain(token);
    const personal = `sntryu_${"b".repeat(64)}`;
    const refused = run({ SENTRY_AUTH_TOKEN: personal }, ["--sentry-token"]);
    expect(refused.status).toBe(1);
    expect(refused.stdout + refused.stderr).not.toContain(personal);
  });

  it("opcionais vazias ou ausentes (CALENDAR, INVITE, VITE_SENTRY_*) não bloqueiam", () => {
    const { VITE_INVITE_API_URL: _omit, ...rest } = OK;
    expect(run({ ...rest, VITE_CALENDAR_SERVICE_URL: "", VITE_SENTRY_ENVIRONMENT: "", VITE_SENTRY_REPLAY_ON_ERROR_RATE: "" }).status).toBe(0);
  });

  it("argumento desconhecido sai 2", () => {
    expect(run(OK, ["--qualquer"]).status).toBe(2);
  });
});
