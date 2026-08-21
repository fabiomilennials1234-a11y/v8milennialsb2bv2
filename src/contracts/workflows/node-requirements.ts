/**
 * O que cada nó de ação PRECISA ter preenchido para conseguir rodar.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * O editor deixava ativar workflow com nó de ação incompleto. Medido em produção
 * (90 dias): ~6.400 execuções mortas por configuração ausente — 3.296 de `add_tag`
 * sem tag, 1.259 de notificação sem membro, 223 de áudio sem URL em 8 orgs.
 * O cliente não vê erro nenhum: a automação simplesmente não acontece.
 *
 * FONTE DA VERDADE
 * ----------------
 * Quem decide de verdade é o executor (`supabase/functions/_shared/`), onde cada
 * regra é um `if (!x) return { error: "..." }` inline, espalhado por 6 arquivos.
 * Reescrever essas regras aqui à mão criaria divergência no primeiro nó novo — que
 * é exatamente como o defeito nasceu. Por isso cada regra carrega o `executorError`
 * que ela previne, e `tests/unit/workflow-node-requirements.test.ts` falha se a
 * string sumir do executor. A âncora não é comentário: é teste.
 *
 * A config do nó mora PLANA em `node.data` — o executor faz `params: {...ctx.nodeData}`.
 */

export type NodeConfig = Record<string, unknown>;

export interface NodeRequirement {
  /** Qualquer uma destas chaves preenchida satisfaz a regra (ex.: tagId OU tagName). */
  anyOf: string[];
  /** O que falta, em português, para o autor do workflow ler. */
  label: string;
  /** Só exigido quando isto for verdade. Ausente = sempre exigido. */
  when?: (config: NodeConfig) => boolean;
  /** Mensagem que o executor produz quando falta. Âncora do teste de deriva. */
  executorError: string;
}

/** Preenchido de verdade — string em branco e array vazio não contam. */
export function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

const midiaDoTipo = (tipo: string) => (c: NodeConfig) =>
  (c.messageType as string | undefined) === tipo;

export const NODE_REQUIREMENTS: Record<string, NodeRequirement[]> = {
  move_stage: [
    { anyOf: ["targetStage"], label: "etapa de destino", executorError: "No target stage configured" },
  ],
  add_tag: [
    { anyOf: ["tagId", "tagName"], label: "tag", executorError: "No tag configured (provide tagId or tagName)" },
  ],
  remove_tag: [
    { anyOf: ["tagId", "tagName"], label: "tag", executorError: "No tag configured (provide tagId or tagName)" },
  ],
  update_lead_field: [
    { anyOf: ["fieldName"], label: "campo do lead", executorError: "No field name configured" },
  ],
  update_custom_field: [
    { anyOf: ["customFieldName"], label: "campo personalizado", executorError: "No custom field name configured" },
  ],
  notify_team_member: [
    { anyOf: ["notifyMemberId"], label: "membro do time a notificar", executorError: "No team member configured" },
  ],
  send_whatsapp_template: [
    { anyOf: ["templateName"], label: "template", executorError: "No template configured" },
  ],
  send_campaign_message: [
    { anyOf: ["campaignId"], label: "campanha", executorError: "No campaign configured" },
    { anyOf: ["campaignTemplateId"], label: "template da campanha", executorError: "No template configured" },
  ],
  send_whatsapp_audio: [
    { anyOf: ["audioUrl"], label: "áudio", executorError: "No audio URL configured" },
  ],
  send_whatsapp_image: [
    { anyOf: ["imageUrl"], label: "imagem", executorError: "No image URL configured" },
  ],
  send_whatsapp_video: [
    { anyOf: ["videoUrl"], label: "vídeo", executorError: "No video URL configured" },
  ],
  send_whatsapp_sticker: [
    { anyOf: ["stickerUrl"], label: "figurinha", executorError: "No sticker URL configured" },
  ],
  send_whatsapp_document: [
    { anyOf: ["documentUrl"], label: "documento", executorError: "No document URL configured" },
  ],

  // Nó consolidado: o que é obrigatório depende do tipo de mensagem escolhido.
  send_whatsapp_message: [
    { anyOf: ["imageUrl"], label: "imagem", when: midiaDoTipo("imagem"), executorError: "No image URL configured" },
    { anyOf: ["videoUrl"], label: "vídeo", when: midiaDoTipo("video"), executorError: "No video URL configured" },
    { anyOf: ["audioUrl"], label: "áudio", when: midiaDoTipo("audio"), executorError: "No audio URL configured" },
    { anyOf: ["stickerUrl"], label: "figurinha", when: midiaDoTipo("sticker"), executorError: "No sticker URL configured" },
  ],

  // Rodízio resolve o responsável em tempo de execução — exigir aqui seria falso
  // positivo, e falso positivo que bloqueia é pior que gate nenhum.
  assign_responsible: [
    {
      anyOf: ["assigneeId"],
      label: "responsável",
      when: (c) => ((c.assignMode as string) || "specific") !== "round_robin",
      executorError: "No team member to assign",
    },
  ],
};

// Ações de campanha que só precisam da campanha escolhida.
for (const tipo of [
  "add_to_campaign",
  "remove_from_campaign",
  "move_campaign_stage",
  "pause_campaign_sequence",
  "resume_campaign_sequence",
]) {
  NODE_REQUIREMENTS[tipo] = [
    { anyOf: ["campaignId"], label: "campanha", executorError: "No campaign configured" },
  ];
}

export interface NodeConfigIssue {
  nodeId: string;
  nodeLabel: string;
  actionType: string;
  /** O que falta, em português. */
  missing: string;
}

interface WorkflowNodeLike {
  id: string;
  type?: string;
  data?: NodeConfig;
}

/**
 * Nós de ação com configuração faltando. Lista vazia = nenhum problema conhecido.
 *
 * Deliberadamente NÃO reclama de actionType desconhecido: nó novo que ainda não
 * tem regra aqui passa. Gate que bloqueia o que não entende trava o produto a cada
 * feature nova — e o time aprende a contorná-lo.
 */
export function findNodeConfigIssues(nodes: WorkflowNodeLike[]): NodeConfigIssue[] {
  const issues: NodeConfigIssue[] = [];

  for (const node of nodes ?? []) {
    const config = node.data ?? {};
    const actionType = config.actionType as string | undefined;
    if (!actionType) continue;

    const regras = NODE_REQUIREMENTS[actionType];
    if (!regras) continue;

    for (const regra of regras) {
      if (regra.when && !regra.when(config)) continue;
      if (regra.anyOf.some((chave) => isFilled(config[chave]))) continue;

      issues.push({
        nodeId: node.id,
        nodeLabel: (config.label as string) || actionType,
        actionType,
        missing: regra.label,
      });
    }
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// Referência podre: o campo ESTÁ preenchido, mas aponta para etapa que não
// existe mais. Classe diferente da anterior — o workflow era válido quando foi
// salvo e apodreceu depois, quando alguém renomeou ou apagou a etapa. Gate de
// ativação não pega isso: ele já estava ativo. Medido: ~1.500 execuções mortas
// em 8+ workflows por essa causa.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Funis cujo destino o executor confere contra `pipeline_stages`.
 * Espelha `move-stage.ts`: os demais (upsell_base, upsell_gestao, campanha) são
 * explicitamente pulados lá, e cobrar aqui seria falso positivo.
 */
export const PIPES_COM_ETAPA_VALIDADA = ["whatsapp", "confirmacao", "propostas"] as const;

/**
 * Nós que apontam para etapa inexistente.
 *
 * `stageKeysByPipe` vem de `pipeline_stages` (ativas) da org. Pipe sem nenhuma
 * etapa cadastrada NÃO acusa — é exatamente o que o executor faz
 * (`if (validKeys.length > 0 && ...)`), e divergir aqui geraria alarme falso.
 */
export function findStageIssues(
  nodes: WorkflowNodeLike[],
  stageKeysByPipe: Record<string, string[]>,
): NodeConfigIssue[] {
  const issues: NodeConfigIssue[] = [];

  for (const node of nodes ?? []) {
    const config = node.data ?? {};
    if ((config.actionType as string) !== "move_stage") continue;

    const alvo = config.targetStage;
    if (!isFilled(alvo)) continue; // campo vazio é a outra regra, não esta

    const pipe = (config.pipeType as string) || "whatsapp";
    if (!(PIPES_COM_ETAPA_VALIDADA as readonly string[]).includes(pipe)) continue;

    const validas = stageKeysByPipe[pipe] ?? [];
    if (validas.length === 0) continue;

    const normalizado = String(alvo).trim().toLowerCase();
    if (validas.some((k) => k.trim().toLowerCase() === normalizado)) continue;

    issues.push({
      nodeId: node.id,
      nodeLabel: (config.label as string) || "move_stage",
      actionType: "move_stage",
      missing: `etapa "${String(alvo)}" não existe mais no funil ${pipe}`,
    });
  }

  return issues;
}
