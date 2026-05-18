/**
 * DEPRECATED — move-card.ts
 *
 * All pipeline move logic has been unified into:
 *   _shared/action-handlers/move-stage.ts
 *
 * This file previously exported executeAdvanceStage and executeUpdatePipelineStage.
 * Both are now fully replaced by the shared moveStage handler.
 * The dispatcher (actions/index.ts) delegates directly to the shared handler.
 *
 * File retained (empty) to avoid import errors in any stale cached modules.
 * Safe to delete once all caches are cleared.
 */
