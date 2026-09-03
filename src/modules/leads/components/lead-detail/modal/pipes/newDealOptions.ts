import type {
  CustomPipelineStatus,
  PipelineStatus,
  StandardPipelineStatus,
} from "../../../../hooks/useLeadAllPipelines";
import type { NewDealOption } from "./NewDealDialog";

/**
 * O construtor das opções de "Novo negócio" — **fora do painel**.
 *
 * Ele nasceu dentro do `CrossPipePanel` (682 linhas, área frágil) e ficou
 * inalcançável de fora. O Card do Lead precisa exatamente da mesma lista para
 * oferecer "Criar negócio" — e a alternativa era recalcular a regra num segundo
 * lugar, que é como duas telas passam a discordar sobre onde a Carteira está
 * travada e sobre qual funil ainda aceita negócio.
 *
 * Aqui não há React de propósito: são decisões sobre dados, e decisão sobre
 * dados se testa direto, sem montar árvore. O painel continua dono do que é
 * dele (trilhos, foco, chips); ele passou a **importar** isto no mesmo diff em
 * que o card passou a usá-lo — se um dia divergirem, é porque alguém copiou de
 * volta, e não porque nasceram separados.
 *
 * ADR-0023 decisão 3: negócio nasce por clique humano. Estas são as portas
 * possíveis desse clique — nada aqui cria nada.
 */

export const SYSTEM_PIPE_SHORT_LABEL: Record<string, string> = {
  whatsapp: "Qualificação",
  confirmacao: "Confirmação",
  propostas: "Propostas",
  upsell: "Carteira",
};

const SYSTEM_PIPE_TYPES = new Set<StandardPipelineStatus["pipeType"]>([
  "whatsapp",
  "confirmacao",
  "propostas",
]);

export function isSystemPipe(p: PipelineStatus): p is StandardPipelineStatus & {
  pipeType: "whatsapp" | "confirmacao" | "propostas";
} {
  return p.type === "standard" && SYSTEM_PIPE_TYPES.has(p.pipeType);
}

export function isUpsellPipe(p: PipelineStatus): p is StandardPipelineStatus {
  return p.type === "standard" && p.pipeType === "upsell";
}

export function isCustomPipe(p: PipelineStatus): p is CustomPipelineStatus {
  return p.type === "custom";
}

export interface NewDealGate {
  allowed: boolean;
  reason?: string | null;
}

export interface BuildNewDealOptionsInput {
  /** Permissão de abrir negócio (`canAddToPipe` de `useLeadActionGates`). */
  canAdd: NewDealGate;
  /**
   * Já houve venda fechada neste lead (`pipe_propostas.status === "vendido"`).
   * É o que destrava a Carteira — ADR-0023 decisão 8: ela é consequência de
   * venda, não negócio novo.
   */
  vendaFechada: boolean;
}

/**
 * Funis em que o lead ainda **não** tem negócio viram opção de abertura.
 *
 * `useLeadAllPipelines` emite uma linha vazia (`pipeId`/`entryId` nulos) por
 * funil sem negócio; é essa linha que se lê como "dá pra abrir aqui". Funil com
 * negócio aberto não aparece — o card dele já está na tela.
 */
export function buildNewDealOptions(
  pipelines: PipelineStatus[],
  { canAdd, vendaFechada }: BuildNewDealOptionsInput,
): NewDealOption[] {
  const systemPipes = pipelines.filter(isSystemPipe);
  const inactiveSystem = systemPipes.filter((p) => p.pipeId === null);
  const upsellPipe = pipelines.find(isUpsellPipe) ?? null;
  const upsellActive = !!upsellPipe?.pipeId;
  const inactiveCustom = pipelines.filter(isCustomPipe).filter((p) => p.entryId === null);

  const semPermissao = canAdd.reason ?? "Sem permissão";
  const out: NewDealOption[] = [];

  for (const p of inactiveSystem) {
    out.push({
      key: `sys:${p.pipeType}`,
      label: SYSTEM_PIPE_SHORT_LABEL[p.pipeType] ?? p.label,
      color: p.color,
      stages: p.stages.map((s) => ({ id: s.id, label: s.label })),
      supportsValue: p.pipeType === "propostas",
      supportsMeeting: p.pipeType === "confirmacao",
      disabled: !canAdd.allowed,
      disabledReason: semPermissao,
    });
  }

  if (upsellPipe && !upsellActive) {
    // Carteira não é negócio novo: é consequência de venda fechada. Fica
    // visível e travada em vez de sumir, pra explicar a regra.
    out.push({
      key: "sys:upsell",
      label: SYSTEM_PIPE_SHORT_LABEL.upsell,
      color: upsellPipe.color,
      stages: upsellPipe.stages.map((s) => ({ id: s.id, label: s.label })),
      disabled: !canAdd.allowed || !vendaFechada,
      disabledReason: !canAdd.allowed
        ? semPermissao
        : "Disponível só quando há venda fechada",
    });
  }

  const sortedCustoms = [...inactiveCustom].sort((a, b) =>
    a.pipelineName.localeCompare(b.pipelineName, "pt-BR"),
  );
  for (const p of sortedCustoms) {
    out.push({
      key: `custom:${p.pipelineId}`,
      label: p.pipelineName,
      color: p.pipelineColor,
      stages: p.stages.map((s) => ({ id: s.id, label: s.name })),
      disabled: !canAdd.allowed,
      disabledReason: semPermissao,
    });
  }

  return out;
}

export type NewDealTarget =
  | { kind: "standard"; pipe: StandardPipelineStatus }
  | { kind: "custom"; pipe: CustomPipelineStatus };

/**
 * Traduz a chave da opção de volta para o funil que a mutation espera.
 *
 * A chave (`sys:<pipeType>` / `custom:<pipelineId>`) é o contrato entre o modal
 * e quem cria. Devolver `null` em vez de adivinhar é deliberado: chave que não
 * casa com funil algum significa que a lista de funis mudou embaixo do modal
 * aberto, e criar "o mais parecido" gravaria o negócio no lugar errado, calado.
 */
export function resolveNewDealTarget(
  optionKey: string,
  pipelines: PipelineStatus[],
): NewDealTarget | null {
  if (optionKey.startsWith("custom:")) {
    const pipelineId = optionKey.slice("custom:".length);
    const pipe = pipelines
      .filter(isCustomPipe)
      .find((p) => p.entryId === null && p.pipelineId === pipelineId);
    return pipe ? { kind: "custom", pipe } : null;
  }

  if (!optionKey.startsWith("sys:")) return null;

  const pipeType = optionKey.slice("sys:".length);
  if (pipeType === "upsell") {
    const pipe = pipelines.find(isUpsellPipe) ?? null;
    return pipe ? { kind: "standard", pipe } : null;
  }

  const pipe = pipelines
    .filter(isSystemPipe)
    .find((p) => p.pipeId === null && p.pipeType === pipeType);
  return pipe ? { kind: "standard", pipe } : null;
}
