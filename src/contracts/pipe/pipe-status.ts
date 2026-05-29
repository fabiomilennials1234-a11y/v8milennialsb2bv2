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

/** Tipos de pipeline canônicos (legacy) + carteira (upsell). */
export type PipelineType =
  | "whatsapp"
  | "confirmacao"
  | "propostas"
  | "upsell_base"
  | "upsell_gestao";

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
    upsell_base: "Carteira Base",
    upsell_gestao: "Carteira Gestão",
  };
  return names[type];
}
