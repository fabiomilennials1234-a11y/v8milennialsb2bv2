#!/usr/bin/env node
/**
 * Starts the real app (Vite dev server) pointed at the ui-preview mock.
 *
 *   node scripts/ui-preview/start-vite.mjs            # http://localhost:4180
 *   UI_PREVIEW_HMR=1 node scripts/ui-preview/start-vite.mjs   # keep HMR (interactive)
 *
 * Env is injected on the PROCESS, which Vite ranks above every .env file —
 * so a stray `.env.local` / `.env.development.local` aimed at a real project
 * can never win here. The guard below re-checks the final values and refuses
 * anything that is not the loopback mock. `npm run dev` is not used, so the
 * `predev` prod guard is replaced by this stricter one.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { MOCK_URL, ANON_KEY, APP_PORT } from "./lib/session.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const env = {
  ...process.env,
  VITE_SUPABASE_URL: MOCK_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: ANON_KEY,
  VITE_SUPABASE_ANON_KEY: ANON_KEY,
  VITE_SUPABASE_PROJECT_ID: "uipreview",
  VITE_APP_VERSION: "ui-preview",
  // never let a real third-party id leak into the preview
  VITE_META_APP_ID: "",
  VITE_META_WA_CONFIG_ID: "",
  VITE_VAPID_PUBLIC_KEY: "",
  VITE_INVITE_API_URL: "",
  VITE_DEMO_MODE: "", // demo mode bypasses the gates we want to exercise
};

const url = new URL(env.VITE_SUPABASE_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
  console.error(`✖ refusing: VITE_SUPABASE_URL=${env.VITE_SUPABASE_URL} is not loopback`);
  process.exit(1);
}

console.log(`ui-preview: vite --mode uipreview on http://localhost:${APP_PORT}  →  Supabase ${MOCK_URL}`);
const config = resolve(ROOT, "scripts/ui-preview/vite.config.mjs"); // vite.config.ts + HMR off
// O bin JS do vite pelo próprio node: `spawn("npx")` sem shell dá ENOENT no
// Windows (npx lá é npx.cmd), e shell: true reabriria a porta para aspas.
const viteBin = resolve(ROOT, "node_modules/vite/bin/vite.js");
const child = spawn(process.execPath, [viteBin, "--config", config, "--mode", "uipreview", "--port", String(APP_PORT), "--strictPort", "--host", "localhost"], {
  cwd: ROOT,
  env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
