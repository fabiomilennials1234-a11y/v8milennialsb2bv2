/**
 * AI Action Executor — fachada de retrocompatibilidade.
 *
 * O conteúdo foi quebrado em `_shared/actions/`:
 *   - actions/types.ts          tipos públicos (ActionRecord, ActionResult, NOOP_ACTION_TYPES)
 *   - actions/index.ts          dispatcher (executeAiAction)
 *   - actions/log-history.ts    logger lead_history + map de descrições
 *   - actions/schedule-meeting.ts
 *   - actions/update-lead.ts
 *   - actions/qualify-lead.ts
 *   - actions/transfer-human.ts (inclui immediateTransferHuman)
 *   - actions/send-document.ts
 *   - actions/_helpers.ts       helpers internos (upsertPipeWhatsapp, executeMoveToPipe)
 *   - action-handlers/move-stage.ts  shared move_stage handler (replaces old move-card.ts)
 *
 * Este arquivo existe apenas para manter os imports históricos
 * funcionando sem churn cross-codebase:
 *   - process-ai-actions/index.ts importa executeAiAction + ActionRecord
 *   - agent-engine.ts importa immediateTransferHuman
 *   - tests/unit/* importam ambos
 */

export type { ActionRecord, ActionResult } from "./actions/types.ts";
export { NOOP_ACTION_TYPES } from "./actions/types.ts";
export { executeAiAction } from "./actions/index.ts";
export { immediateTransferHuman } from "./actions/transfer-human.ts";
