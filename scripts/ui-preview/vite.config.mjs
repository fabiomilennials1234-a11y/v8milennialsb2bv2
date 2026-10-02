/**
 * The app's own vite.config.ts, with HMR off.
 *
 * Why: src/ is often being edited while screenshots run. With HMR on, every
 * save hot-swaps or full-reloads the page mid-shot (black/white frames,
 * half-applied styles). With it off, each page load still gets the latest
 * transformed source — the shot is just never interrupted.
 * `UI_PREVIEW_HMR=1` turns HMR back on for interactive use.
 */
import { defineConfig, mergeConfig } from "vite";
import baseConfig from "../../vite.config.ts";

export default defineConfig(async (env) => {
  const base = typeof baseConfig === "function" ? await baseConfig(env) : baseConfig;
  return mergeConfig(base, {
    server: { hmr: process.env.UI_PREVIEW_HMR === "1" ? {} : false },
  });
});
