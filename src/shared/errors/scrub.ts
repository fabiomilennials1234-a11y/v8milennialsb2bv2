/**
 * Tira dado de lead de um texto técnico antes que ele saia da tela — para o
 * anel do Chamado agora, para o Sentry na S6 (ADR-0038, decisão 4).
 *
 * Mesma regra do `runtime_logs` (`_shared/logger.ts#maskPhone`): sequência longa
 * de dígitos fica com os 4 primeiros e os 4 últimos, o que ainda casa uma linha
 * de log com uma conversa sem expor o número. E-mail fica com a primeira letra e
 * o domínio. CPF/CNPJ formatados ficam com os 2 últimos dígitos.
 */

const MIN_MASKABLE_DIGITS = 10;

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const CNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;
const LONG_DIGITS = /\d{6,}/g;

function keepLastTwo(value: string): string {
  return value.replace(/\d(?=(?:\D*\d){2})/g, "*");
}

export function scrubPii(text: string): string {
  return text
    // JID do WhatsApp tem forma de e-mail, mas é telefone: a regra de dígitos
    // abaixo cuida dele e preserva o sufixo.
    .replace(EMAIL, (match, first: string, domain: string) =>
      /(^|\.)(whatsapp\.net|g\.us|lid)$/i.test(domain) ? match : `${first}***@${domain}`,
    )
    .replace(CNPJ, keepLastTwo)
    .replace(CPF, keepLastTwo)
    .replace(LONG_DIGITS, (digits) =>
      digits.length < MIN_MASKABLE_DIGITS
        ? digits
        : digits.slice(0, 4) + "*".repeat(digits.length - 8) + digits.slice(-4),
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Resumo técnico de uma causa: nome, código e mensagem — **sem** `details` nem
 * `hint` do Postgres, que carregam o valor da linha (`Key (phone)=(5511…) already
 * exists`). O código e a mensagem bastam para achar o defeito; o valor é do lead
 * do nosso cliente.
 */
export function technicalSummary(cause: unknown): string {
  if (cause == null) return "sem causa";
  if (typeof cause === "string") return scrubPii(cause.trim()) || "sem mensagem";

  if (isRecord(cause)) {
    const name = typeof cause.name === "string" && cause.name ? cause.name : null;
    const code = typeof cause.code === "string" && cause.code ? cause.code : null;
    const message = typeof cause.message === "string" ? cause.message.trim() : "";
    const head = [name, code].filter(Boolean).join(" ");
    const summary = head ? `${head}: ${message}` : message;
    return scrubPii(summary) || "sem mensagem";
  }

  return scrubPii(String(cause));
}
