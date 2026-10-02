/**
 * Playwright helpers: inject the fake Supabase session (and theme) into
 * localStorage BEFORE the app boots, and launch a Chromium that exists on
 * this machine.
 *
 *   import { launchBrowser, prepareContext } from "./browser-session.mjs";
 *   const browser = await launchBrowser();
 *   const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
 *   await prepareContext(context, { theme: "dark" });
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { STORAGE_KEY, buildSession } from "./lib/session.mjs";
import { buildFixtures } from "./fixtures/seed.mjs";

export { STORAGE_KEY };

/**
 * Pre-seeded localStorage. Keys:
 *  - `sb-127-auth-token`  supabase-js session (see lib/session.mjs)
 *  - `v8-theme`           next-themes storageKey (App.tsx) — "light" | "dark"
 *  - `selected_org_id`    useCurrentTeamMember's org pin
 */
export function initialStorage({ theme = "dark", master = false } = {}) {
  const fx = buildFixtures({ master });
  return {
    local: {
      [STORAGE_KEY]: JSON.stringify(buildSession(fx)),
      "v8-theme": theme,
      "torque-theme": theme,
      selected_org_id: fx.orgId,
      // First-run overlays that would cover every screenshot. Marked as seen.
      "torque:announce:support-realtime:launch": "1",
      "torque:announce:support-realtime:nudge-off": "1",
      [`torque:support-announcement:v1:${fx.authUser.id}`]: JSON.stringify({ shownCount: 99, engaged: true, coachDone: true }),
      "overdue-banner-dismissed": "1",
    },
    session: {
      "torque:support-announcement:session-shown": "1",
      "torque:announce:support-realtime:nudge-session": "1",
      onb_prime_done: "1",
    },
  };
}

/**
 * @param opts.theme  "dark" | "light"
 * @param opts.master seed a master session (mock must run with --master)
 * @param opts.now    epoch ms to pin the browser clock to (mock's /__health
 *                    `now`) so relative dates match the fixtures; null = real time
 */
export async function prepareContext(context, opts = {}) {
  const storage = initialStorage(opts);
  // install(): the clock STARTS at the fixture instant and then flows in real
  // time. (setFixedTime freezes Date.now and stalls the kanban's time-based
  // reveal — the board stays blank.)
  if (opts.now != null) await context.clock.install({ time: opts.now });
  await context.addInitScript((entries) => {
    try {
      // Only on the app origin; never touch other origins.
      if (!/^localhost$|^127\.0\.0\.1$/.test(location.hostname)) return;
      for (const [k, v] of Object.entries(entries.local)) localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(entries.session)) sessionStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  }, storage);
}

/** Playwright's pinned Chromium may not be downloaded; fall back to what exists. */
export async function launchBrowser({ headless = true } = {}) {
  const tries = [];
  if (process.env.UI_PREVIEW_CHROME) tries.push({ executablePath: process.env.UI_PREVIEW_CHROME });
  tries.push({});
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse()) {
      const exe = join(cache, dir, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
      if (existsSync(exe)) tries.push({ executablePath: exe });
    }
    for (const dir of readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const exe = join(cache, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
      if (existsSync(exe)) tries.push({ executablePath: exe });
    }
  }
  tries.push({ channel: "chrome" });
  let lastErr;
  for (const t of tries) {
    try {
      return await chromium.launch({ headless, ...t });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
