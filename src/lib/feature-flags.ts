/**
 * feature-flags.ts — Build-time feature flags via env vars (Vite).
 *
 * Flags controladas por variáveis de ambiente com prefixo VITE_.
 * Default: todos os flags desativados — backwards-compatible.
 *
 * Uso:
 *   import { featureFlags } from '@/lib/feature-flags';
 *   if (featureFlags.chatOnda2b) { ... }
 */

export const featureFlags = {
  /**
   * chatOnda2b — ativa o ChatShell 3-col em /chat.
   *
   * Quando true: <ChatShellWithContext> substitui <WhatsAppChat>.
   * Quando false (padrão): <WhatsAppChat> legacy continua renderizando.
   *
   * Ativar: VITE_CHAT_ONDA_2B=true no .env ou variável de ambiente do build.
   */
  chatOnda2b: import.meta.env.VITE_CHAT_ONDA_2B === "true",
} as const;
