#!/usr/bin/env node
/**
 * Prova ponta a ponta da troca de interface por organização, sem backend real:
 * build dual contra o Supabase mockado da harness, servida com as regras do
 * nginx (serve-dual.mjs), e um navegador fazendo o caminho do admin.
 *
 *   node scripts/ui-classic/e2e-troca.mjs [--sem-build] [--out .ui-shots/troca]
 *
 * 1. Sem cookie, a org na clássica → chega a clássica e o cookie vira `classic`.
 * 2. Liga "Nova interface" na clássica → recarrega na V5, cookie `v5`.
 * 3. Desliga na V5 → recarrega na clássica, cookie `classic`.
 * 4. Org na V5 e cookie velho `classic` (outro admin trocou) → a guarda leva
 *    sozinha para a V5.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PORTA_MOCK = 54421;
const PORTA_APP = 4196;
process.env.UI_PREVIEW_MOCK_PORT = String(PORTA_MOCK);
const { MOCK_URL, ANON_KEY } = await import("../ui-preview/lib/session.mjs");
const { launchBrowser, prepareContext } = await import("../ui-preview/browser-session.mjs");

const args = process.argv.slice(2);
const OUT = resolve(RAIZ, args.includes("--out") ? args[args.indexOf("--out") + 1] : ".ui-shots/troca");
mkdirSync(OUT, { recursive: true });

if (!args.includes("--sem-build")) {
  console.log("build dual contra o mock…");
  execFileSync("npm", ["run", "build:dual"], {
    cwd: RAIZ,
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      VITE_SUPABASE_URL: MOCK_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: ANON_KEY,
      VITE_SUPABASE_ANON_KEY: ANON_KEY,
      VITE_SUPABASE_PROJECT_ID: "uipreview",
      VITE_APP_VERSION: "e2e-troca",
      VITE_META_APP_ID: "",
      VITE_META_WA_CONFIG_ID: "",
      VITE_INVITE_API_URL: "",
      VITE_DEMO_MODE: "",
      VITE_UI_SWITCH: "true",
      // Prova local: aceita a clássica provisória (ver merge-dist.mjs).
      UI_CLASSIC_PERMITE_PROVISORIA: "1",
    },
  });
}

const entrada = (arquivo) => /src="(\/assets\/index-[^"]+\.js)"/.exec(readFileSync(join(RAIZ, "dist", arquivo), "utf8"))?.[1];
const ENTRADA = { v5: entrada("index.html"), classic: entrada("index.classic.html") };
if (!ENTRADA.v5 || !ENTRADA.classic || ENTRADA.v5 === ENTRADA.classic) throw new Error(`entradas inválidas: ${JSON.stringify(ENTRADA)}`);

const filhos = [];
const subir = (script, extraArgs, env) => {
  const p = spawn(process.execPath, [join(RAIZ, script), ...extraArgs], { cwd: RAIZ, stdio: "ignore", env: { ...process.env, ...env } });
  filhos.push(p);
};
process.on("exit", () => filhos.forEach((p) => p.exitCode === null && p.kill("SIGTERM")));
subir("scripts/ui-preview/mock-supabase.mjs", ["--port", String(PORTA_MOCK), "--quiet"], { UI_PREVIEW_ORG_UI_V5: "0" });
subir("scripts/ui-classic/serve-dual.mjs", ["--port", String(PORTA_APP)], {});
for (let i = 0; i < 60; i++) {
  try {
    await fetch(`${MOCK_URL}/__health`);
    await fetch(`http://localhost:${PORTA_APP}/`);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await prepareContext(context, { theme: "light" });
const page = await context.newPage();
const erros = [];
page.on("pageerror", (e) => erros.push(String(e)));

const BASE = `http://localhost:${PORTA_APP}`;
const buildAtual = () =>
  page.evaluate((e) => {
    const srcs = [...document.querySelectorAll("script[type=module]")].map((s) => new URL(s.src).pathname);
    return srcs.includes(e.v5) ? "v5" : srcs.includes(e.classic) ? "classic" : "?";
  }, ENTRADA);
const cookie = async () => (await context.cookies(BASE)).find((c) => c.name === "torque_ui")?.value ?? null;
/** Espera a guarda decidir: rede parada e mais um respiro para o efeito rodar. */
const assentar = async () => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);
  await page.waitForLoadState("networkidle").catch(() => {});
};

let falhas = 0;
const conferir = (passo, ok, detalhe) => {
  console.log(`${ok ? "✔" : "✖"} ${passo}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas++;
};

async function trocarPeloSwitch(rotaConfig, botaoConfirmar, arquivo) {
  await page.goto(`${BASE}${rotaConfig}`);
  await assentar();
  const chave = page.getByRole("switch", { name: "Nova interface" });
  await chave.waitFor({ state: "visible", timeout: 15000 });
  await page.screenshot({ path: join(OUT, `${arquivo}-antes.png`) });
  await chave.click();
  await page.getByRole("button", { name: botaoConfirmar }).click();
  await page.waitForEvent("load", { timeout: 20000 });
  await assentar();
  await page.screenshot({ path: join(OUT, `${arquivo}-depois.png`) });
}

try {
  // 1
  await page.goto(`${BASE}/`);
  await assentar();
  conferir("1. sem cookie, org na clássica → clássica", (await buildAtual()) === "classic", await buildAtual());
  conferir("1. a guarda grava o cookie `classic`", (await cookie()) === "classic", String(await cookie()));
  await page.screenshot({ path: join(OUT, "1-classica.png") });

  // 2
  await trocarPeloSwitch("/configuracoes/outros?tab=general", "Ligar interface nova", "2-liga-na-classica");
  conferir("2. ligar na clássica → V5", (await buildAtual()) === "v5", await buildAtual());
  conferir("2. cookie `v5`", (await cookie()) === "v5", String(await cookie()));

  // 3
  await trocarPeloSwitch("/configuracoes/geral", "Voltar para a clássica", "3-desliga-na-v5");
  conferir("3. desligar na V5 → clássica", (await buildAtual()) === "classic", await buildAtual());
  conferir("3. cookie `classic`", (await cookie()) === "classic", String(await cookie()));

  // 4 — outro admin ligou; este navegador ainda tem o cookie velho.
  await fetch(`${MOCK_URL}/rest/v1/rpc/set_org_settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ p_org_id: (await import("../ui-preview/fixtures/seed.mjs")).buildFixtures({}).orgId, p_patch: { ui_v5_enabled: true } }),
  });
  await page.goto(`${BASE}/dashboard`);
  await assentar();
  await page.waitForLoadState("load");
  await assentar();
  conferir("4. org trocada por outro admin → a guarda leva para a V5", (await buildAtual()) === "v5", await buildAtual());
  await page.screenshot({ path: join(OUT, "4-guarda-leva-para-v5.png") });

  conferir("sem erro de página", erros.length === 0, erros.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
console.log(falhas ? `\n${falhas} falha(s). Prints em ${OUT}` : `\nTroca de interface OK. Prints em ${OUT}`);
process.exit(falhas ? 1 : 0);
