/**
 * Dado de lead e segredo fora de texto que sai da função (ADR-0038).
 *
 * Espelho do `scrubPii` do front (`src/shared/errors/scrub.ts`): sequência longa
 * de dígitos fica com os 4 primeiros e os 4 últimos (a regra do `maskPhone` do
 * `logger.ts`), e-mail com a primeira letra e o domínio, CPF/CNPJ formatados com
 * os 2 últimos dígitos. UUID fica intacto — é o que casa uma linha com a outra.
 *
 * `scrubText` também limpa URL dentro de texto livre: o erro de `fetch` do Deno
 * traz a URL inteira ("error sending request for url (https://…?access_token=…)").
 */

const MIN_MASKABLE_DIGITS = 10;
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>()]+/g;

function keepLastTwo(value: string): string {
  return value.replace(/\d(?=(?:\D*\d){2})/g, "*");
}

function scrubSegment(text: string): string {
  return text
    .replace(
      /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
      (match, first: string, domain: string) =>
        /(^|\.)(whatsapp\.net|g\.us|lid)$/i.test(domain) ? match : `${first}***@${domain}`,
    )
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, keepLastTwo)
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, keepLastTwo)
    .replace(/\d{6,}/g, (digits) =>
      digits.length < MIN_MASKABLE_DIGITS
        ? digits
        : digits.slice(0, 4) + "*".repeat(digits.length - 8) + digits.slice(-4));
}

export function scrubPii(text: string): string {
  return text
    .split(UUID)
    .map((part, index) => (index % 2 === 1 ? part : scrubSegment(part)))
    .join("");
}

export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Texto livre: URL sem query/fragmento e PII mascarada. */
export function scrubText(text: string): string {
  return scrubPii(text.replace(URL_IN_TEXT, (url) => stripQuery(url)));
}
