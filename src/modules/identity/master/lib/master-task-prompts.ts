import type { PromptComplexity } from "./master-tasks";

export type PromptTarget = "codex" | "claude";
interface Recommendation { model: string; label: string; effort: "low" | "medium" | "high" }
export const COMPLEXITY_LABELS: Record<PromptComplexity, string> = { baixa: "Baixa", media: "Média", alta: "Alta" };
export const TARGET_LABELS: Record<PromptTarget, string> = { codex: "Codex", claude: "Claude Code" };

// Política inicial do Torque, revisada em 26/10/2026. Não é benchmark nem promessa
// de disponibilidade. Fontes e critérios: docs/features/master-tasks.md.
export const PROMPT_RECOMMENDATIONS: Record<PromptComplexity, Record<PromptTarget, Recommendation>> = {
  baixa: {
    codex: { model: "gpt-6.1-sol", label: "GPT-6.1 Sol", effort: "low" },
    claude: { model: "sonnet", label: "Sonnet", effort: "medium" },
  },
  media: {
    codex: { model: "gpt-6.1-sol", label: "GPT-6.1 Sol", effort: "medium" },
    claude: { model: "opus", label: "Opus", effort: "medium" },
  },
  alta: {
    codex: { model: "gpt-6-astra", label: "GPT-6 Astra", effort: "high" },
    claude: { model: "opus", label: "Opus", effort: "high" },
  },
};

export function executionPrompt(input: { title: string; context: string; description: string; prompt_complexity: PromptComplexity }, target: PromptTarget): string {
  const route = PROMPT_RECOMMENDATIONS[input.prompt_complexity][target];
  return [
    `Tarefa: ${input.title.trim()}`,
    `Ambiente: ${TARGET_LABELS[target]}\nModelo recomendado: ${route.label} (${route.model})\nEsforço recomendado: ${route.effort}`,
    "Realize a tarefa abaixo. Comece conferindo o contexto e as instruções do projeto. Confirme no material disponível as hipóteses do plano antes de alterar qualquer coisa; se faltar informação essencial, peça somente o necessário.",
    input.context.trim() ? `Contexto informado pelo solicitante\n${input.context.trim()}` : "",
    input.description.trim(),
    "Ao terminar, informe o que foi feito, como verificou os critérios de conclusão e eventuais pendências. Não afirme ter executado verificações que não realizou.",
  ].filter(Boolean).join("\n\n");
}
