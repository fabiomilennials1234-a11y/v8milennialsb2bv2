/**
 * convertLegacyMenuNode — conversão EXPLÍCITA do nó legado `action` +
 * `send_whatsapp_menu` em `question_buttons` (pergunta com botões).
 *
 * Por que explícita e não migração de dados: o menu legado tem UMA saída sem
 * handle; a pergunta com botões tem uma saída por botão + "Outra resposta",
 * "Sem resposta" e "Falha no envio". Não existe mapeamento honesto da aresta
 * antiga para essas saídas — então ela é removida e o usuário religa, vendo o
 * que mudou. O nó legado que ninguém converter continua executando pelo
 * handler antigo (`sendWhatsAppMenu`).
 *
 * Também é o caminho de quem escolhe "WhatsApp Menu" no seletor de tipo de
 * qualquer ação: a mesma regra de texto, instância e arestas.
 *
 * Pura: não muta entradas. Quem chama tira o snapshot (desfazer) e avisa.
 */
import type {
  ActionNodeData,
  QuestionButtonsNodeData,
  WorkflowEdge,
  WorkflowNode,
} from "@/types/workflow";

/** Limite de botões do WhatsApp (e do contrato `question_buttons`). */
export const MAX_QUESTION_BUTTONS = 3;

const DEFAULT_TIMEOUT_HOURS = 24;

/** Saídas fixas da pergunta com botões, além de `button:<id>`. */
const FIXED_OUTPUT_HANDLES = new Set(["other_response", "timeout", "send_failure"]);

export interface ConvertLegacyMenuResult {
  node: WorkflowNode;
  edges: WorkflowEdge[];
  /** Arestas de saída removidas: o usuário precisa religar estas saídas. */
  droppedEdgeIds: string[];
  /** Opções além do limite de botões, que ficaram de fora. */
  droppedChoices: string[];
}

/** "Rótulo|id" ou "Rótulo|https://…" → "Rótulo". Quebras de linha viram espaço. */
function choiceLabel(choice: unknown): string {
  if (typeof choice !== "string") return "";
  return choice.split("|")[0].replace(/[\r\n]+/g, " ").trim();
}

export interface MenuChoiceLabels {
  /** Rótulos únicos (sem diferenciar maiúsculas), na ordem original. */
  labels: string[];
  /** Os que viram botão: os primeiros `MAX_QUESTION_BUTTONS`. */
  kept: string[];
  /** Os que ficam de fora por passar do limite. */
  dropped: string[];
}

/**
 * Regra única de rótulos do menu legado: tira o sufixo "|id", descarta vazios
 * e repetidos (sem diferenciar maiúsculas) e corta no limite de botões. O
 * cartão do nó legado usa a mesma função — o aviso de corte tem que bater com
 * o que a conversão realmente faz.
 */
export function normalizeMenuChoiceLabels(choices: unknown): MenuChoiceLabels {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const choice of Array.isArray(choices) ? choices : []) {
    const label = choiceLabel(choice);
    const key = label.toLocaleLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return {
    labels,
    kept: labels.slice(0, MAX_QUESTION_BUTTONS),
    dropped: labels.slice(MAX_QUESTION_BUTTONS),
  };
}

function newButtonId(): string {
  return crypto.randomUUID();
}

export function convertLegacyMenuNode(node: WorkflowNode, edges: WorkflowEdge[]): ConvertLegacyMenuResult {
  if (node.data.type !== "action") {
    throw new Error(`convertLegacyMenuNode: nó ${node.id} não é uma ação (${node.data.type})`);
  }
  const action = node.data as ActionNodeData;

  const { kept, dropped: droppedChoices } = normalizeMenuChoiceLabels(action.menuChoices);
  const buttons = (kept.length ? kept : ["Opção 1"]).map(label => ({ id: newButtonId(), label }));

  const text = (action.menuText?.trim() ? action.menuText : action.messageTemplate) ?? "";

  const data: QuestionButtonsNodeData = {
    type: "question_buttons",
    label: action.label,
    text,
    buttons,
    timeoutHours: DEFAULT_TIMEOUT_HOURS,
  };
  // null = instância pendente após importação (o editor cobra); "" = conversa.
  if (action.whatsappInstanceId === null) data.instanceId = null;
  else if (action.whatsappInstanceId) data.instanceId = action.whatsappInstanceId;

  const validHandles = new Set([...FIXED_OUTPUT_HANDLES, ...buttons.map(button => `button:${button.id}`)]);
  const droppedEdgeIds: string[] = [];
  const nextEdges = edges.filter(edge => {
    if (edge.source !== node.id) return true;
    if (edge.sourceHandle && validHandles.has(edge.sourceHandle)) return true;
    droppedEdgeIds.push(edge.id);
    return false;
  });

  return {
    node: { ...node, type: "question_buttons", data },
    edges: nextEdges,
    droppedEdgeIds,
    droppedChoices,
  };
}
