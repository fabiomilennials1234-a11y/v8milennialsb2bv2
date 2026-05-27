/**
 * feature-flags.ts — Build-time feature flags via env vars (Vite).
 *
 * Flags controladas por variáveis de ambiente com prefixo VITE_.
 * Default: todos os flags desativados — backwards-compatible.
 *
 * Uso:
 *   import { featureFlags } from '@/modules/platform/lib/feature-flags';
 *   if (featureFlags.chatBubble) { ... }
 */

export const featureFlags = {
  /**
   * chatBubble — widget flutuante (FAB + painel) nas Pipe pages.
   *
   * Quando true E pathname starts with `/pipe`: renderiza Bubble Provider + FAB.
   * Auto-hide em `/chat` e `/chat-whatsapp/*` (evita dual-render com ChatShell).
   *
   * Default dev=on, prod=off até validação manual.
   * Ativar: VITE_CHAT_BUBBLE=true no .env ou variável de ambiente do build.
   */
  chatBubble: import.meta.env.VITE_CHAT_BUBBLE === "true",
} as const;
