/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Injetado por `define` no vite.config.ts — o sha do build. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /**
   * "true" só no build de produção (Dockerfile): liga a troca entre a
   * interface nova e a clássica por organização (`UiVersionGuard`).
   */
  readonly VITE_UI_SWITCH?: string;
}
