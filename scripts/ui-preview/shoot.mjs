#!/usr/bin/env node
/**
 * Screenshots every real route of the app (served by start-vite.mjs, backed
 * by mock-supabase.mjs) in light + dark at 1440×900 and 390×844.
 *
 *   node scripts/ui-preview/shoot.mjs [label] [options]
 *
 *   label                 output folder name (default: timestamp)
 *   --out <dir>           output root (default /tmp/ui-preview-shots/<label>)
 *   --routes a,b,c        only these route names (see routes.mjs)
 *   --themes dark,light   default: dark,light
 *   --widths 1440,390     default: 1440,390
 *   --full-page           capture the whole document height
 *   --direct              load each route by URL and wait out the intro
 *                         animation (default: boot on /privacidade, then
 *                         client-side navigate — same app, no 3.3 s intro)
 *   --master              include master-only routes (mock must run --master)
 *   --real-clock          do not pin the browser clock to the fixture clock
 *
 * Starts nothing: run the mock and vite first (see README.md).
 * Output: <out>/<theme>-<width>/<route>.png + <out>/report.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser, prepareContext } from "./browser-session.mjs";
import { ROUTES } from "./routes.mjs";
import { APP_URL, MOCK_URL } from "./lib/session.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 ? argv[i + 1] : d;
};
const has = (n) => argv.includes(n);
const VALUE_OPTS = new Set(["--out", "--routes", "--themes", "--widths"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !VALUE_OPTS.has(argv[i - 1]));
const label = positional[0] ?? new Date().toISOString().replace(/[:.]/g, "-");
const OUT = opt("--out", join("/tmp/ui-preview-shots", label));
const themes = opt("--themes", "dark,light").split(",");
const widths = opt("--widths", "1440,390").split(",").map(Number);
const only = opt("--routes", null)?.split(",");
const FULL_PAGE = has("--full-page");
const DIRECT = has("--direct");
const MASTER = has("--master");
const REAL_CLOCK = has("--real-clock");

const HEIGHT = { 1440: 900, 390: 844 };
const INTRO_MS = 3500; // TorqueIntro plays once per full page load (3.25 s)
// TorqueIntro skips public paths and only decides on mount: booting on one of
// them and then navigating client-side renders the target route with no intro.
const BOOT_PATH = "/privacidade";

async function health() {
  try {
    const r = await fetch(`${MOCK_URL}/__health`);
    return await r.json();
  } catch {
    return null;
  }
}

const mock = await health();
if (!mock) {
  console.error(`✖ mock not reachable at ${MOCK_URL} — run: node scripts/ui-preview/mock-supabase.mjs`);
  process.exit(1);
}
try {
  await fetch(APP_URL);
} catch {
  console.error(`✖ app not reachable at ${APP_URL} — run: node scripts/ui-preview/start-vite.mjs`);
  process.exit(1);
}
if (MASTER && !mock.master) console.warn("⚠ --master given but the mock runs without --master; master routes will redirect.");

const routes = ROUTES.filter((r) => (only ? only.includes(r.name) : true)).filter((r) => (r.master ? MASTER : true));
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const report = { label, startedAt: new Date().toISOString(), app: APP_URL, mock: MOCK_URL, master: mock.master, results: [] };

/**
 * Wait until the screen is still: no HTTP request in flight, no DOM mutation
 * and no TorqueLoader for `quietMs`, after at least `minMs`. Capped at `maxMs`
 * (a live clock or spinner never goes quiet — the shot is taken anyway).
 */
async function settle(page, inflight, { quietMs = 900, minMs = 1500, maxMs = 15000 } = {}) {
  await page
    .evaluate(() => {
      window.__uiPreviewLastMutation = performance.now();
      if (window.__uiPreviewObserver) return;
      window.__uiPreviewObserver = new MutationObserver(() => (window.__uiPreviewLastMutation = performance.now()));
      window.__uiPreviewObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    })
    .catch(() => {});
  const start = Date.now();
  let quietSince = Date.now();
  while (Date.now() - start < maxMs) {
    const domIdleMs = await page.evaluate(() => performance.now() - (window.__uiPreviewLastMutation ?? 0)).catch(() => 0);
    const loaderVisible = await page.locator("[data-torque-loader]").first().isVisible().catch(() => false);
    if (inflight.size > 0 || loaderVisible || domIdleMs < quietMs) quietSince = Date.now();
    if (Date.now() - start >= minMs && Date.now() - quietSince >= quietMs) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

async function clientNavigate(page, path) {
  await page.evaluate((p) => {
    const idx = (window.history.state?.idx ?? 0) + 1;
    window.history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx }, "", p);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  }, path);
}

async function detectState(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText ?? "";
    return {
      errorBoundary: /Algo deu errado|Atualização Detectada/.test(text) && /recarregar a página|Recarregue a página/i.test(text),
      envMissing: /Configuração necessária/.test(text) && /VITE_SUPABASE_URL/.test(text),
      login: location.pathname.startsWith("/auth"),
      awaitingActivation: /Aguardando Ativação|Conta Desativada/.test(text),
      featureLocked: /Recurso bloqueado|Faça upgrade|Disponível no plano/i.test(text),
      notFound: /404|Página não encontrada/i.test(text) && text.length < 600,
      textSample: text.replace(/\s+/g, " ").slice(0, 240),
    };
  });
}

for (const theme of themes) {
  for (const width of widths) {
    const dir = join(OUT, `${theme}-${width}`);
    mkdirSync(dir, { recursive: true });
    await fetch(`${MOCK_URL}/__reset`);
    const mobile = width < 768;
    const context = await browser.newContext({
      viewport: { width, height: HEIGHT[width] ?? 900 },
      deviceScaleFactor: 1,
      isMobile: mobile,
      hasTouch: mobile,
      colorScheme: theme === "light" ? "light" : "dark",
      reducedMotion: "reduce",
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
    });
    await prepareContext(context, { theme, master: MASTER, now: REAL_CLOCK ? null : mock.now });
    const page = await context.newPage();

    const inflight = new Set();
    let consoleErrors = [];
    let pageErrors = [];
    let failed = [];
    page.on("request", (r) => inflight.add(r));
    page.on("requestfinished", (r) => inflight.delete(r));
    page.on("requestfailed", (r) => {
      inflight.delete(r);
      if (!/realtime|hot-update|__vite/.test(r.url())) failed.push(`${r.method()} ${r.url().slice(0, 160)} — ${r.failure()?.errorText}`);
    });
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (/X-Frame-Options may only be set|frame-ancestors' is ignored|requires a `DialogTitle`|Download the React DevTools/.test(t)) return;
      consoleErrors.push(t.slice(0, 400));
    });
    page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e).slice(0, 400)));

    for (const route of routes) {
      const t0 = Date.now();
      // Fresh app per route: no state, blocker or error boundary leaks between routes.
      if (DIRECT) {
        consoleErrors = [];
        pageErrors = [];
        failed = [];
        await page.goto(APP_URL + route.path, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(INTRO_MS);
      } else {
        await page.goto(APP_URL + BOOT_PATH, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => (document.getElementById("root")?.childElementCount ?? 0) > 0, null, { timeout: 15000 }).catch(() => {});
        consoleErrors = [];
        pageErrors = [];
        failed = [];
        await clientNavigate(page, route.path);
      }
      const settled = await settle(page, inflight);
      await page.waitForTimeout(400); // last paint / chart layout
      const state = await detectState(page);
      const file = join(dir, `${route.name}.png`);
      await page.screenshot({ path: file, fullPage: FULL_PAGE });
      const log = await (await fetch(`${MOCK_URL}/__log?since=${t0}`)).json().catch(() => []);
      const misses = [...new Set(log.filter((e) => e.miss).map((e) => `${e.kind} ${e.name}${e.note ? ` (${e.note})` : ""}`))];
      const finalUrl = new URL(page.url());
      const result = {
        route: route.name,
        path: route.path,
        theme,
        width,
        file,
        finalPath: finalUrl.pathname + finalUrl.search,
        redirected: finalUrl.pathname !== new URL(APP_URL + route.path).pathname,
        settled,
        ...state,
        consoleErrors: [...new Set(consoleErrors)],
        pageErrors: [...new Set(pageErrors)],
        failedRequests: [...new Set(failed)],
        mockMisses: misses,
        ms: Date.now() - t0,
      };
      report.results.push(result);
      const flags = [
        state.errorBoundary && "ERROR-BOUNDARY",
        state.envMissing && "ENV-MISSING",
        state.login && "LOGIN",
        result.redirected && `→${result.finalPath}`,
        result.pageErrors.length && `${result.pageErrors.length} pageerror`,
        result.consoleErrors.length && `${result.consoleErrors.length} console.error`,
      ].filter(Boolean);
      console.log(`${theme}-${width} ${route.name.padEnd(24)} ${String(result.ms).padStart(5)}ms ${flags.join(" ")}`);
    }
    await context.close();
  }
}

await browser.close();
report.finishedAt = new Date().toISOString();
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
const bad = report.results.filter((r) => r.errorBoundary || r.envMissing || r.login || r.pageErrors.length);
console.log(`\n${report.results.length} screenshots → ${OUT}`);
console.log(`report: ${join(OUT, "report.json")}${bad.length ? `  (${bad.length} with errors)` : ""}`);
