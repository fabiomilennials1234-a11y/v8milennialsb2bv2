/**
 * Agregador de loaders de contexto.
 *
 * Re-exporta os loaders compartilhados (`_shared/copilot/context-loader.ts`,
 * `rag.ts`) sob a pasta engine/ pra que o agent-engine.ts possa importar
 * tudo de um caminho unico. Mantem nomes originais sem renomear.
 *
 * Loaders de historico ficam em engine/history.ts (separados pq tem logica
 * de compressao/extracao especifica do agent-message).
 */

export {
  loadCapabilities,
  loadOrgCustomFields,
  loadPipelineStages,
  loadDocumentSummaries,
  loadConversation,
  loadLeadData,
  loadProductCatalog,
  loadConversationContextSummary,
  getDefaultContext,
  type ConversationContextSummary,
} from "../../_shared/copilot/context-loader.ts";

export {
  retrieveSemanticContext,
  retrieveLongTermMemories,
} from "../../_shared/copilot/rag.ts";

export { executeSearchKnowledge } from "../../_shared/copilot/search-knowledge.ts";
