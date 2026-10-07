#!/usr/bin/env node
/**
 * Confere o ambiente da build de produção ANTES de buildar (job `build` de
 * .github/workflows/deploy-front-cloudflare.yml). Sem dependência: roda antes
 * do `npm ci`.
 *
 *   node scripts/cloudflare/check-build-env.mjs                 # VITE_* do bundle
 *   node scripts/cloudflare/check-build-env.mjs --sentry-token  # SENTRY_AUTH_TOKEN (só no step da build)
 *
 * Obrigatórias: as 5 de REQUIRED_BUILD_ENV. Opcionais (vazias = comportamento
 * normal do app): VITE_CALENDAR_SERVICE_URL (nenhum código lê), VITE_INVITE_API_URL
 * (vazia, o convite cai no Supabase), VITE_SENTRY_ENVIRONMENT e
 * VITE_SENTRY_REPLAY_ON_ERROR_RATE. Opcional também não pode parecer segredo.
 *
 * Por que falhar cedo: o Vite não reclama de variável faltando — troca
 * `import.meta.env.VITE_X` por `undefined` e builda. O front sai "verde" e
 * quebra no navegador (sem Supabase não há login), ou sai inerte (sem as
 * variáveis da Meta, o WhatsApp Oficial vira toast de "configuração pendente").
 *
 * E por que recusar segredo: tudo que começa com VITE_ vai para o bundle
 * público. Uma chave `sb_secret_` ou um JWT `service_role` colado no lugar da
 * publishable key seria publicado para qualquer um. A varredura é a mesma do
 * cf:prepare (scripts/cloudflare/prepare-assets.mjs), só que antes da build.
 *
 * Nunca imprime valor: as mensagens citam só o NOME da variável.
 */
import { pathToFileURL } from "node:url";
import { parseArgs } from "./lib.mjs";
import { scanContent } from "./prepare-assets.mjs";

/**
 * As que o bundle de produção usa com valor (medido no bundle no ar em
 * 2026-10-07): sem elas o app não loga (Supabase) ou desliga um recurso (Meta).
 */
export const REQUIRED_BUILD_ENV = Object.freeze([
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PROJECT_ID",
  "VITE_META_APP_ID",
  "VITE_META_WA_CONFIG_ID",
]);

const SUPABASE_HOST = /^([a-z0-9]{20})\.supabase\.co$/;

/** Problemas das VITE_* (lista vazia = ok). */
export function checkBuildEnv(env) {
  const problems = [];
  for (const name of REQUIRED_BUILD_ENV) {
    if (!env[name]?.trim()) problems.push(`${name} ausente ou vazia (variável do environment front-build)`);
  }

  const rawUrl = env.VITE_SUPABASE_URL?.trim();
  if (rawUrl) {
    let host = null;
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || url.pathname !== "/" || url.search) problems.push("VITE_SUPABASE_URL tem de ser https://<projeto>.supabase.co, sem caminho");
      host = url.hostname;
    } catch {
      problems.push("VITE_SUPABASE_URL não é uma URL");
    }
    const project = host?.match(SUPABASE_HOST)?.[1];
    if (host && !project) problems.push("VITE_SUPABASE_URL não é um host <projeto>.supabase.co");
    const projectId = env.VITE_SUPABASE_PROJECT_ID?.trim();
    if (project && projectId && project !== projectId) problems.push("VITE_SUPABASE_PROJECT_ID não é o projeto de VITE_SUPABASE_URL");
  }

  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("VITE_") || !value) continue;
    // scanContent devolve "<rótulo>: <motivo>"; o rótulo aqui é o nome, nunca o valor.
    for (const problem of scanContent(name, Buffer.from(value))) problems.push(`${problem} — VITE_* vai para o bundle público`);
  }
  return problems;
}

/**
 * O token do upload de source map. Mesma política do upload falho (o plugin
 * do Sentry registra o erro e a build segue): token AUSENTE não bloqueia o
 * deploy — a build sai sem upload, com aviso. O que bloqueia é token PESSOAL
 * (`sntryu_`): ele carrega o acesso inteiro de uma pessoa e não vai para CI.
 * O esperado é token de organização (`sntrys_`, escopo org:ci).
 *
 * Devolve `{ errors, warnings }`.
 */
export function checkSentryToken(env) {
  const token = env.SENTRY_AUTH_TOKEN?.trim();
  if (!token) {
    return {
      errors: [],
      warnings: [
        "SENTRY_AUTH_TOKEN ausente (secret do environment front-build): build SEM upload de source map e sem debug ids — erros de produção chegam ao Sentry ilegíveis, e o bundle deixa de ser byte a byte o do EasyPanel",
      ],
    };
  }
  if (token.startsWith("sntryu_")) return { errors: ["SENTRY_AUTH_TOKEN é token PESSOAL (sntryu_); use um token de organização (sntrys_, escopo org:ci)"], warnings: [] };
  if (!token.startsWith("sntrys_")) return { errors: [], warnings: ["SENTRY_AUTH_TOKEN fora do formato de token de organização (sntrys_); confira se não é token pessoal antigo"] };
  return { errors: [], warnings: [] };
}

/** Aviso que o GitHub Actions mostra no resumo da execução; texto puro fora dele. */
const warn = (env, message) => console.log(env.GITHUB_ACTIONS === "true" ? `::warning::${message}` : `aviso: ${message}`);

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2), { "sentry-token": "boolean" });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const sentry = args["sentry-token"] === true;
  const { errors, warnings } = sentry ? checkSentryToken(process.env) : { errors: checkBuildEnv(process.env), warnings: [] };
  for (const message of warnings) warn(process.env, message);
  if (errors.length > 0) {
    console.error(`check-build-env recusou o ambiente da build:\n${errors.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  if (sentry) console.log(warnings.length === 0 ? "ok: SENTRY_AUTH_TOKEN de organização presente" : "ok: a build segue (ver aviso)");
  else console.log(`ok: ${REQUIRED_BUILD_ENV.length} VITE_* obrigatórias presentes, nenhuma VITE_* com cara de segredo`);
}
