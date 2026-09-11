import type {
  ConditionNodeData,
  GuidedConditionDraft,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from "@/types/workflow";

export type LegacyConditionReviewKind =
  | "semantic_change"
  | "requires_mapping"
  | "unsupported"
  | "preserved_wait";

export interface LegacyConditionReviewItem {
  nodeId: string;
  label: string;
  kind: LegacyConditionReviewKind;
  before: string;
  after: string;
  details: string;
  blocksPublication: boolean;
}

export interface LegacyConditionReview {
  items: LegacyConditionReviewItem[];
  blockingCount: number;
}

const TEXT_FIELDS: Record<string, string> = {
  name: "lead.name",
  company: "lead.company",
  email: "lead.email",
  phone: "lead.phone",
  segment: "lead.segment",
  urgency: "lead.urgency",
  faturamento: "lead.faturamento",
  utm_source: "lead.utm_source",
  utm_medium: "lead.utm_medium",
  utm_content: "lead.utm_content",
  utm_term: "lead.utm_term",
  utm_campaign: "lead.utm_campaign",
};

const TEXT_OPERATORS = new Set([
  "equals", "not_equals", "contains", "not_contains", "starts_with", "ends_with",
  "is_empty", "is_not_empty",
]);

const NUMBER_OPERATORS: Record<string, string> = {
  equals: "equals",
  not_equals: "not_equals",
  greater_than: "greater_than",
  greater_or_equal: "greater_than_or_equal",
  less_than: "less_than",
  less_or_equal: "less_than_or_equal",
  is_empty: "is_empty",
  is_not_empty: "is_not_empty",
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isLegacyCondition(node: WorkflowNode): boolean {
  return node.type === "condition" && !Object.prototype.hasOwnProperty.call(node.data, "guidedCondition");
}

function sourceSummary(data: ConditionNodeData): string {
  if ((data.conditionMode ?? "field") === "time_window") {
    const window = data.timeWindow;
    return `Horário ${window?.startTime ?? "08:00"}–${window?.endTime ?? "18:00"}, ${window?.timezone ?? "America/Sao_Paulo"}`;
  }
  const value = data.operator === "is_empty" || data.operator === "is_not_empty" ? "" : ` · ${data.value || "sem valor"}`;
  return `${data.field || "sem campo"} · ${data.operator || "sem operador"}${value}`;
}

function classify(node: WorkflowNode): LegacyConditionReviewItem {
  const data = node.data as ConditionNodeData;
  const base = { nodeId: node.id, label: data.label || "Condição", before: sourceSummary(data) };
  if ((data.conditionMode ?? "field") === "time_window") {
    return { ...base, kind: "preserved_wait", after: "Permanece no executor legado",
      details: "Esta condição continua pausando a execução fora da janela. O condicional guiado decide Sim ou Não e nunca espera; a troca exige redesenho explícito com o nó Janela Comercial.",
      blocksPublication: true };
  }
  if (data.operator === "regex_match") {
    return { ...base, kind: "unsupported", after: "Sem conversão automática",
      details: "Regex aceita padrões técnicos e não possui operador equivalente no catálogo guiado. Escolha informação, comparação e valor novamente.",
      blocksPublication: true };
  }
  if (data.field === "origin" && noValueOperator(data.operator)) {
    return { ...base, kind: "semantic_change", after: `Origem ${data.operator === "is_empty" ? "está vazia" : "está preenchida"}`,
      details: "Vazio continua distinto de qualquer valor cadastrado e dispensa seleção adicional.",
      blocksPublication: false };
  }
  if (data.field === "tags" || data.field === "tag") {
    return { ...base, kind: "requires_mapping", after: "Selecionar a tag cadastrada",
      details: "O legado guardava o nome da tag. Mesmo nome não prova identidade; selecione o UUID atual explicitamente.",
      blocksPublication: true };
  }
  if (data.field === "origin") {
    return { ...base, kind: "requires_mapping", after: "Selecionar a origem cadastrada",
      details: "O legado guardava slug ou texto. A nova regra exige a identidade atual da origem.",
      blocksPublication: true };
  }
  if (data.field === "custom" || data.field.startsWith("custom.")) {
    return { ...base, kind: "requires_mapping", after: "Selecionar campo e tipo cadastrados",
      details: "O legado endereçava campo personalizado por nome. Renome e homônimo são ambíguos; selecione o UUID e confirme o tipo.",
      blocksPublication: true };
  }
  if (data.field === "stage" || data.field === "stage_id") {
    return { ...base, kind: "requires_mapping", after: "Selecionar funil e etapa exatos",
      details: "Chave, nome ou UUID isolado não comprovam o par funil + etapa exigido pela nova regra.",
      blocksPublication: true };
  }
  if (["pre_sale_responsible_id", "sale_responsible_id"].includes(data.field) && noValueOperator(data.operator)) {
    return { ...base, kind: "semantic_change", after: `${data.field === "sale_responsible_id" ? "Responsável de vendas" : "Responsável de pré-vendas"} ${data.operator === "is_empty" ? "está vazio" : "está preenchido"}`,
      details: "Vazio continua distinto de uma pessoa selecionada e dispensa identidade adicional.",
      blocksPublication: false };
  }
  if (["pre_sale_responsible_id", "sale_responsible_id", "any_responsible", "sdr_id"].includes(data.field)) {
    return { ...base, kind: "requires_mapping", after: "Selecionar função e pessoa",
      details: data.field === "any_responsible" || data.field === "sdr_id"
        ? "O alias antigo não define de forma inequívoca pré-vendas ou vendas. Escolha a função e a identidade atual."
        : "Confirme a identidade atual da pessoa; o nome exibido não substitui o UUID.",
      blocksPublication: true };
  }
  if (data.field === "score" || data.field === "deal_value") {
    if (!NUMBER_OPERATORS[data.operator]
      || (!noValueOperator(data.operator) && !Number.isFinite(Number(data.value)))) {
      return { ...base, kind: "unsupported", after: "Escolher comparação numérica",
        details: "Operador ou valor antigo não forma uma comparação numérica tipada. Revise manualmente.",
        blocksPublication: true };
    }
    return { ...base, kind: "semantic_change",
      after: data.field === "score" ? "Pontuação de qualificação tipada" : "Valor do negócio exato do gatilho",
      details: "O legado tratava ausência como zero. A nova regra distingue vazio de zero e usa comparação numérica tipada.",
      blocksPublication: false };
  }
  if (TEXT_FIELDS[data.field] && TEXT_OPERATORS.has(data.operator)) {
    return { ...base, kind: "semantic_change", after: `${TEXT_FIELDS[data.field]} · ${data.operator}`,
      details: noValueOperator(data.operator)
        ? "Vazio continua separado de texto preenchido e não exige valor adicional."
        : "A comparação continua ignorando maiúsculas e passa também a ignorar acentos. Revise essa ampliação antes de publicar.",
      blocksPublication: false };
  }
  return { ...base, kind: "unsupported", after: "Escolher uma condição guiada",
    details: "Campo, alias ou operador não possui equivalência comprovada. Nenhuma equivalência automática será presumida.",
    blocksPublication: true };
}

export function inspectLegacyConditions(definition: WorkflowDefinition): LegacyConditionReview {
  const items = definition.nodes.filter(isLegacyCondition).map(classify);
  return { items, blockingCount: items.filter(item => item.blocksPublication).length };
}

function noValueOperator(operator: string): operator is "is_empty" | "is_not_empty" {
  return operator === "is_empty" || operator === "is_not_empty";
}

function textRule(id: string, field: string, operator: string, value: string): GuidedConditionDraft {
  return ({ version: 1, id, field, operator,
    ...(noValueOperator(operator) ? {} : { value }) }) as GuidedConditionDraft;
}

function numericRule(id: string, field: string, operator: string, value: string): GuidedConditionDraft {
  const mapped = NUMBER_OPERATORS[operator] ?? "equals";
  return ({ version: 1, id, field, operator: mapped,
    ...(noValueOperator(mapped) ? {} : { value: Number.isFinite(Number(value)) ? Number(value) : "" }) }) as GuidedConditionDraft;
}

function pendingRule(id: string, data: ConditionNodeData): GuidedConditionDraft {
  if (data.field === "tags" || data.field === "tag") {
    return { version: 1, id, field: "lead.tags",
      operator: data.operator === "not_has_tag" ? "not_has_tag" : "has_tag", tagId: "", tagLabel: data.value };
  }
  if (data.field === "origin") {
    return ({ version: 1, id, field: "lead.origin",
      operator: data.operator === "not_equals" ? "not_equals" : "equals", originId: "", originLabel: data.value }) as GuidedConditionDraft;
  }
  if (data.field === "custom" || data.field.startsWith("custom.")) {
    const operator = TEXT_OPERATORS.has(data.operator) ? data.operator : "equals";
    return ({ version: 1, id, field: "lead.custom", fieldId: "", fieldType: "text",
      fieldLabel: data.field.startsWith("custom.") ? data.field.slice(7) : "Campo personalizado",
      operator, ...(noValueOperator(operator) ? {} : { value: data.value }) }) as GuidedConditionDraft;
  }
  if (data.field === "stage" || data.field === "stage_id") {
    return { version: 1, id, field: "business.trigger.stage",
      operator: data.operator === "not_equals" || data.operator === "not_in_stage" ? "not_equals" : "equals",
      pipelineId: "", stageId: "", stageLabel: data.value };
  }
  if (["pre_sale_responsible_id", "sale_responsible_id", "any_responsible", "sdr_id"].includes(data.field)) {
    return ({ version: 1, id,
      field: data.field === "sale_responsible_id" ? "lead.sale_responsible_id" : "lead.pre_sale_responsible_id",
      operator: data.operator === "not_equals" ? "not_equals" : noValueOperator(data.operator) ? data.operator : "equals",
      ...(noValueOperator(data.operator) ? {} : { memberId: "", memberLabel: data.value }) }) as GuidedConditionDraft;
  }
  return { version: 1, id, field: "lead.name", operator: "equals", value: "" };
}

function convertNode(node: WorkflowNode, item: LegacyConditionReviewItem, generateId: () => string): WorkflowNode {
  if (item.kind === "preserved_wait") return clone(node);
  const data = clone(node.data) as ConditionNodeData;
  const id = generateId();
  let guidedCondition: GuidedConditionDraft;
  if (TEXT_FIELDS[data.field] && TEXT_OPERATORS.has(data.operator)) {
    guidedCondition = textRule(id, TEXT_FIELDS[data.field], data.operator, data.value);
  } else if (data.field === "origin" && noValueOperator(data.operator)) {
    guidedCondition = { version: 1, id, field: "lead.origin", operator: data.operator };
  } else if (["pre_sale_responsible_id", "sale_responsible_id"].includes(data.field) && noValueOperator(data.operator)) {
    guidedCondition = ({ version: 1, id,
      field: data.field === "sale_responsible_id" ? "lead.sale_responsible_id" : "lead.pre_sale_responsible_id",
      operator: data.operator }) as GuidedConditionDraft;
  } else if (data.field === "score") {
    guidedCondition = numericRule(id, "lead.qualification_score", data.operator, data.value);
  } else if (data.field === "deal_value") {
    guidedCondition = numericRule(id, "business.trigger.value", data.operator, data.value);
  } else {
    guidedCondition = pendingRule(id, data);
  }
  return { ...node, data: { ...data, guidedCondition, ...(item.blocksPublication ? { legacyConditionReview: {
    kind: item.kind, details: item.details, source: clone(data),
  } } : {}) } };
}

function normalizeHandle(edge: WorkflowEdge): WorkflowEdge {
  const handle = edge.sourceHandle?.toLowerCase() ?? "";
  if (handle === "a" || handle.includes("true") || handle.includes("yes")) return { ...edge, sourceHandle: "yes" };
  if (handle === "b" || handle.includes("false") || handle.includes("no")) return { ...edge, sourceHandle: "no" };
  return edge;
}

export function buildLegacyConditionReviewDraft(
  definition: WorkflowDefinition,
  generateId: () => string = () => crypto.randomUUID(),
): { definition: WorkflowDefinition; review: LegacyConditionReview } {
  const review = inspectLegacyConditions(definition);
  const byNode = new Map(review.items.map(item => [item.nodeId, item]));
  const convertedIds = new Set(review.items.filter(item => item.kind !== "preserved_wait").map(item => item.nodeId));
  return {
    review,
    definition: {
      nodes: definition.nodes.map(node => {
        const item = byNode.get(node.id);
        return item ? convertNode(node, item, generateId) : clone(node);
      }),
      edges: definition.edges.map(edge => convertedIds.has(edge.source) ? normalizeHandle(clone(edge)) : clone(edge)),
    },
  };
}
