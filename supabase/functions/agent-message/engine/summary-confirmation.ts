const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Conservative opt-in: changed data must be summarized again before CRM writes. */
export function summaryConfirmationGate(message: string, history: Array<{ role: string; content: unknown }>) {
  const text = normalize(message).trim();
  const lastAssistant = [...history].reverse().find(item => item.role === "assistant");
  const summary = normalize(typeof lastAssistant?.content === "string" ? lastAssistant.content : "");
  const explicitHuman = /\b(quero|preciso|gostaria|prefiro|posso|pode|me)\b.{0,65}\b(falar|conversar|chame|chamar|passe|passar|encaminh|transfir|transfer|atendente|humano|vendedor)/.test(text)
    && /\b(humano|atendente|vendedor|pessoa|equipe)\b/.test(text)
    && !/\b(nao quero|nao preciso|nao transfira|nao encaminhe)\b/.test(text);
  const humanException = /\b(reclamacao|reclamar|negociacao especial|grande volume|duvida tecnica)\b/.test(text);
  const correction = /\b(corrig|correc|alter|troqu|trocar|mude|mudar|na verdade|mas|porem|menos|exceto|ainda|falta|nao confere|nao confirmo|nao esta|nao pode)/.test(text) || /\d/.test(text);
  const affirmative = /^(sim\b|confere\b|confirmo\b|confirmado\b|correto\b|certo\b|perfeito\b|ok\b|tudo (certo|correto)\b|esta (certo|correto)\b|pode (seguir|registrar|encaminhar|continuar|prosseguir)\b)/.test(text);
  const askedConfirmation = /\b(confere|confirma|correto|certo)\b[^?]*\?/.test(summary);
  return { confirmed: askedConfirmation && affirmative && !correction, humanRequested: explicitHuman || humanException };
}
