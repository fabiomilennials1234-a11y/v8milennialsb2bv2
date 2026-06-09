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
    "Você reescreve uma mensagem de follow-up para um lead que ENGAJOU e depois",
    "FICOU EM SILÊNCIO. Objetivo: reabrir a conversa e EMPURRAR PARA A FRENTE.",
    "",
    "Regras:",
    "- Mantenha a INTENÇÃO da mensagem-base (reengajar).",
    "- Termine com UMA pergunta leve ou um próximo passo concreto que convide a responder.",
    "- NÃO repita nem re-prometa o que já foi dito na conversa (ex.: não prometa de novo",
    "  que 'o consultor vai entrar em contato' se isso já foi dito) — isso não reabre nada.",
    "- Use o contexto só para referenciar o ASSUNTO real (produto/interesse), não para resumir.",
    "- Breve (1-2 frases). NÃO invente fatos, preços ou promessas que não apareceram.",
    "- Responda APENAS com a mensagem final, sem aspas.",
    "",
    "Mensagem-base:",
    baseText,
    "",
    history ? "Conversa recente (do mais antigo ao mais novo):" : "Sem histórico de conversa.",
    history,
    "",
    "Mensagem final:",
  ].filter(Boolean).join("\n");
}
