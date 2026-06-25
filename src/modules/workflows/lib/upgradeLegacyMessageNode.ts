/**
 * upgradeLegacyMessageNode — lazy migration of legacy WhatsApp send nodes into
 * the unified "Enviar Mensagem" node (ADR-0012).
 *
 * Pure. Applied when a workflow is loaded in the editor; the converted shape is
 * persisted on the next save. No SQL/backfill — the legacy action handlers stay
 * alive so unmigrated DAGs keep running.
 *
 *   send_whatsapp            → messageType "texto"
 *   send_whatsapp_audio      → messageType "audio"
 *   send_whatsapp_image      → messageType "imagem"
 *   send_whatsapp_sticker    → messageType "sticker"
 *   send_whatsapp_menu       → messageType "menu"
 *   send_whatsapp_pix_button → messageType "pix"
 *
 * generate_ai_message (generates without sending) and every non-message node
 * pass through untouched. Idempotent.
 */
import type { ActionNodeData, MessageType } from "@/types/workflow";

const LEGACY_TO_MESSAGE_TYPE: Record<string, MessageType> = {
  send_whatsapp: "texto",
  send_whatsapp_audio: "audio",
  send_whatsapp_image: "imagem",
  send_whatsapp_sticker: "sticker",
  send_whatsapp_menu: "menu",
  send_whatsapp_pix_button: "pix",
};

/** Convert a single action node's data. Returns the input unchanged when it is
 *  not a legacy WhatsApp sender (idempotent for already-unified nodes). */
export function upgradeLegacyMessageNodeData(data: ActionNodeData): ActionNodeData {
  if (!data || data.actionType === "send_whatsapp_message") return data;
  const messageType = LEGACY_TO_MESSAGE_TYPE[data.actionType];
  if (!messageType) return data;
  return { ...data, actionType: "send_whatsapp_message", messageType };
}

interface WorkflowNodeLike {
  data?: ActionNodeData | Record<string, unknown>;
  [key: string]: unknown;
}

/** Map over editor nodes, upgrading action nodes in place. Non-action nodes and
 *  nodes that need no change are returned by reference (no needless churn). */
export function upgradeWorkflowNodes<T extends WorkflowNodeLike>(nodes: T[]): T[] {
  return nodes.map((node) => {
    const data = node?.data as ActionNodeData | undefined;
    if (!data || data.type !== "action" || !data.actionType) return node;
    const upgraded = upgradeLegacyMessageNodeData(data);
    return upgraded === data ? node : { ...node, data: upgraded };
  });
}
