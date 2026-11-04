/**
 * O webhook dobra a mensagem citada em `whatsapp_messages.content` como
 * `[Em resposta a: "..."]\n<corpo>` (a IA e a busca full-text leem esse texto).
 * Na bolha, a citação é desenhada à parte; este helper separa as duas partes SEM
 * alterar o `content` cru, que continua sendo o que a busca usa.
 *
 * Tolera aspas retas e curvas, citação multilinha e aspas dentro do texto
 * citado: o fecho é a PRIMEIRA aspa seguida de `]` e de quebra de linha/fim.
 */
const PREFIXO = /^\s*\[Em resposta a: ["“”]([\s\S]*?)["“”]\](?:\r?\n|$)/;

export interface QuotedReplyParts {
  /** Texto citado extraído do prefixo, ou null se `content` não tem prefixo. */
  quoted: string | null;
  /** `content` sem o prefixo (igual ao original quando não há prefixo). */
  body: string;
}

export function splitQuotedReplyPrefix(content: string | null | undefined): QuotedReplyParts {
  if (typeof content !== "string" || content.length === 0) return { quoted: null, body: content ?? "" };
  const match = PREFIXO.exec(content);
  if (!match) return { quoted: null, body: content };
  const quoted = match[1].trim();
  return { quoted: quoted || null, body: content.slice(match[0].length) };
}
