/**
 * Contracts — pipe status + pipeline type.
 *
 * Símbolos PUROS (zero side-effect, zero React/Supabase) compartilhados entre
 * `leads` e `pipelines`. Vivem aqui (camada `contracts`, sem dependências de
 * domínio) para que `leads` consuma sem import direto de `pipelines/hooks/*` —
 * passo da inversão de dependência que quebra o ciclo leads↔pipelines.
 *
 * Owner conceitual: pipelines (re-exporta via barrel + hooks legacy, mantendo
 * a API pública estável). A definição CANÔNICA mora aqui.
 */

/**
 * Tipos de pipeline canônicos (legacy).
 *
 * SCRUM-618 (ADR-0034, D9): `upsell_base`/`upsell_gestao` saíram deste union —
 * Carteira NÃO é funil (funis aposentados em 20270805000010). Quem precisa ler
 * as etapas remanescentes da carteira usa o caminho dedicado do módulo
 * carteira (`useCarteiraStages`), tipado por `CarteiraStageFamily`.
 * Este union inteiro morre na F4/F6 da unificação de funis.
 */
export type PipelineType = "whatsapp" | "confirmacao" | "propostas";

/**
 * Resíduo Carteira (D9/ADR-0034): as duas famílias de etapa que sobraram em
 * `pipeline_stages.pipeline_type` depois da aposentadoria dos funis de
 * carteira (linhas inativas, `pipeline_id` NULL — D-b da 20270906001000).
 * NÃO são funis: não entram em `PipelineType`, webhook, workflows nem Copilot.
 * Faxina final na W6.
 */
export type CarteiraStageFamily = "upsell_base" | "upsell_gestao";

/**
 * Família de etapa aceita pelo editor compartilhado de etapas e pelas
 * mutations de `pipeline_stages`: os 3 funis de sistema (legacy) + o resíduo
 * carteira. É o domínio real de `pipeline_stages.pipeline_type` que o front
 * ainda escreve/edita — mais largo que `PipelineType` (funil), mais estreito
 * que `string`.
 */
export type StageFamily = PipelineType | CarteiraStageFamily;

/**
 * Status de um lead em cada pipe legacy. Hoje todos são `string` (slug do
 * `stage_key`) — aliases nominais mantidos por legibilidade nos call sites.
 */
export type PipeWhatsappStatus = string;
export type PipeConfirmacaoStatus = string;
export type PipePropostasStatus = string;

/** Retorna o nome amigável (PT-BR) do tipo de pipeline. */
export function getPipelineTypeName(type: PipelineType): string {
  const names: Record<PipelineType, string> = {
    whatsapp: "Qualificação",
    confirmacao: "Confirmação",
    propostas: "Propostas",
  };
  return names[type];
}

/**
 * Nome amigável de uma família de etapa — funis + resíduo carteira.
 * Uso restrito ao editor compartilhado de etapas (que ainda atende a
 * Carteira via slots); superfícies de FUNIL usam `getPipelineTypeName`.
 */
export function getStageFamilyName(family: StageFamily): string {
  if (family === "upsell_base") return "Carteira Base";
  if (family === "upsell_gestao") return "Carteira Gestão";
  return getPipelineTypeName(family);
}
