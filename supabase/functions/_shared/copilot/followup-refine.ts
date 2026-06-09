/**
 * LLM refine for Copilot Follow-up (#736).
 *
 * Pure prompt builder. The worker calls the LLM with this prompt to personalize
 * the Torque-authored base text using live conversation context; the base text
 * is the deterministic fallback when the LLM is unavailable, fails, or returns
 * something empty. Only the prompt construction lives here (pure/testable); the
 * LLM call + fallback are glue in the worker.
 */

export interface RefineMessage {
  role: "user" | "assistant";
  content: string;
}

export function buildRefinePrompt(params: {
  baseText: string;
  recentMessages: RefineMessage[];
}): string {
  const { baseText, recentMessages } = params;

  const history = recentMessages
    .map((m) => `${m.role === "user" ? "Lead" : "Nós"}: ${m.content}`)
    .join("\n");

  return [
    "Você reescreve uma mensagem de follow-up para soar natural e pessoal,",
    "reaproveitando o contexto real da conversa abaixo. Mantenha a INTENÇÃO da",
    "mensagem-base. Seja breve (1-3 frases). NÃO invente fatos, preços ou",
    "promessas que não apareceram na conversa. Responda APENAS com a mensagem final.",
    "",
    "Mensagem-base:",
    baseText,
    "",
    history ? "Conversa recente:" : "Sem histórico de conversa.",
    history,
    "",
    "Mensagem final:",
  ].filter(Boolean).join("\n");
}
