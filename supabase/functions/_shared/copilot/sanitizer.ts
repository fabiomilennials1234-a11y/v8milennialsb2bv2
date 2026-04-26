/**
 * Trilha 3.B Fase B1 / T3B.1 — Sanitizer (módulo copilot)
 *
 * Re-export do _shared/message-sanitizer.ts pra organizar sob _shared/copilot/.
 * Path antigo mantido como facade durante transição (zero breaking change).
 *
 * Callers novos devem importar daqui:
 *   import { sanitizeAssistantMessage } from "../_shared/copilot/sanitizer.ts";
 */

export {
  sanitizeAssistantMessage,
  splitByDelimiter,
} from "../message-sanitizer.ts";

export type { SanitizeResult, RecoveredAction } from "../message-sanitizer.ts";
