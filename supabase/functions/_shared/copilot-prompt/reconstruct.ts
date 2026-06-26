// Reconstrói um ComposeInput a partir de uma row de copilot_agents + docs.
// Usa os flags can_* vivos do DB — NÃO o comportamento lossy do Playground
// (que hardcoda PREENCHER_CAMPOS=true e ignora ENVIAR_DOCUMENTO/TRANSFERIR_SZ_CHAT/CRIAR_CAMPO).
// Ref: DESIGN.md §3.2 — Fidelidade de reconstruct.
import { TOOLS_CATALOG } from "./tools-catalog.ts";
import type {
  ComposeDoc,
  ComposeInput,
  ComposePromptSections,
  ComposeToolState,
} from "./compose.ts";

export const DEFAULT_PROMPT_SECTIONS: ComposePromptSections = {
  personality: "",
  objective: "",
  flow: "",
  products: "",
  instructions: "",
};

export interface AgentRow {
  conversation_style?: {
    promptSections?: Partial<ComposePromptSections>;
    toolInstructions?: Record<string, string>;
  } | null;
  can_qualify_lead?: boolean;
  can_schedule_meeting?: boolean;
  can_move_cards?: boolean;
  can_transfer_human?: boolean;
  can_create_lead?: boolean;
  can_update_lead?: boolean;
  can_send_document?: boolean;
  can_transfer_sz_chat?: boolean;
  human_pause_enabled?: boolean;
}

export interface DocRow {
  id: string;
  file_name: string;
  file_type: string | null;
  description?: string | null;
  send_when?: string | null;
}

/**
 * Mapeamento tool id → getter da flag viva no AgentRow.
 * CRIAR_CAMPO não tem flag dedicada → sempre false.
 * PAUSAR_ATENDIMENTO_HUMANO usa human_pause_enabled (default true se ausente).
 */
const FLAG_BY_TOOL: Record<string, (a: AgentRow) => boolean> = {
  QUALIFICAR_LEAD: (a) => a.can_qualify_lead === true,
  AGENDAR_REUNIAO: (a) => a.can_schedule_meeting === true,
  MOVER_CARD: (a) => a.can_move_cards === true,
  TRANSFERIR_HUMANO: (a) => a.can_transfer_human === true,
  CRIAR_LEAD: (a) => a.can_create_lead === true,
  PREENCHER_CAMPOS: (a) => a.can_update_lead === true,
  TRANSFERIR_SZ_CHAT: (a) => a.can_transfer_sz_chat === true,
  ENVIAR_DOCUMENTO: (a) => a.can_send_document === true,
  CRIAR_CAMPO: () => false,
  PAUSAR_ATENDIMENTO_HUMANO: (a) => a.human_pause_enabled !== false,
};

/**
 * Mescla um patch parcial sobre o estado atual das seções.
 * Garante que os 5 campos sempre existam (preenche com DEFAULT onde ausente).
 */
export function mergeSections(
  current: ComposePromptSections,
  patch: Partial<ComposePromptSections>,
): ComposePromptSections {
  return { ...DEFAULT_PROMPT_SECTIONS, ...current, ...patch };
}

/**
 * Reconstrói um ComposeInput completo a partir de uma row de copilot_agents
 * e seus documentos associados (copilot_agent_documents).
 *
 * - promptSections: do conversation_style.promptSections (ou defaults vazios)
 * - tools: habilitados pelos flags can_* vivos (não pelo Playground lossy)
 * - documents: mapeados de DocRow → ComposeDoc
 * - links: sempre [] (links não são persistidos no DB hoje)
 */
export function agentRowToComposeInput(agent: AgentRow, docs: DocRow[]): ComposeInput {
  const cs = agent.conversation_style ?? {};
  const promptSections: ComposePromptSections = {
    ...DEFAULT_PROMPT_SECTIONS,
    ...(cs.promptSections ?? {}),
  };
  const toolInstr = cs.toolInstructions ?? {};

  const tools: ComposeToolState[] = TOOLS_CATALOG.map((def) => ({
    id: def.id,
    enabled: (FLAG_BY_TOOL[def.id] ?? (() => false))(agent),
    instruction: toolInstr[def.id] ?? "",
  }));

  const documents: ComposeDoc[] = docs.map((d) => ({
    id: d.id,
    name: d.file_name,
    fileType: d.file_type === "image" || d.file_type === "video" ? d.file_type : "document",
    description: d.description ?? "",
    sendWhen: d.send_when ?? "",
  }));

  return { promptSections, tools, documents, links: [] };
}
