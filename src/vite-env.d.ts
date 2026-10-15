/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Injetado por `define` no vite.config.ts — o sha do build. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** DSN do projeto `torque-web` no Sentry. Sem ele o SDK não chega ao navegador (ADR-0038). */
  readonly VITE_SENTRY_DSN?: string;
  /** Padrão: `production` no build de produção, `development` fora dele. */
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  /** 0 a 1 — fração dos erros relatados que levam a gravação. Padrão 1. */
  readonly VITE_SENTRY_REPLAY_ON_ERROR_RATE?: string;
}
