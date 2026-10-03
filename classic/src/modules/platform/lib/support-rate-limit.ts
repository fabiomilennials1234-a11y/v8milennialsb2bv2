/**
 * support-rate-limit — o limite de abertura de Chamados.
 *
 * Cinco por hora, por usuário, enforced no banco (ADR-0018). Sem captcha, sem
 * fila de moderação, sem verificação de email: um usuário autenticado de um
 * tenant pagante não é spammer — é gente com problema. O limite existe para
 * conter loop acidental e abuso grosseiro, não para desconfiar do cliente.
 *
 * Comentar num chamado existente nunca é limitado.
 *
 * Lógica pura: só a leitura do erro que o trigger levanta.
 */

export const TICKETS_PER_HOUR = 5;

/**
 * Marcador que o trigger emite. Existe para o cliente não ter que casar a
 * mensagem inteira, que muda quando alguém a reescreve.
 */
const MARKER = "rate_limit_chamados";
const MARKER_RE = new RegExp(`${MARKER}(?::(\\d{2}:\\d{2}))?`);

export type RateLimitCheck = { limited: true; nextAt: string | null } | { limited: false };

export function parseRateLimitError(error: unknown): RateLimitCheck {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : "";

  const match = MARKER_RE.exec(message);
  if (!match) return { limited: false };

  return { limited: true, nextAt: match[1] ?? null };
}

/** Oferece a saída, não acusa. */
export function rateLimitMessage(nextAt: string | null): string {
  const quando = nextAt ? ` Você pode abrir o próximo às ${nextAt}.` : "";
  return (
    `Você abriu ${TICKETS_PER_HOUR} chamados na última hora.${quando}` +
    " Se for sobre algo que já relatou, responda no chamado existente."
  );
}
