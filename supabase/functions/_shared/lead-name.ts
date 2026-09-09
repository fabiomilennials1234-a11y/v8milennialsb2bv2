/**
 * Lead display-name helpers + the placeholder names auto-assigned when a lead
 * is created without a real name (only a phone number, or nothing).
 *
 * Single source of truth for the placeholder pattern so every customer-facing
 * personalization path can detect and suppress it. A lead auto-created from an
 * inbound WhatsApp gets named "WhatsApp 2952" (last 4 phone digits) — we must
 * never greet the person as "Boa tarde WhatsApp 2952".
 */

/** Fallback name for a lead created without a real name (used by getOrCreateLead). */
export function buildPlaceholderLeadName(normalizedPhone: string | null): string {
  return normalizedPhone
    ? `WhatsApp ${normalizedPhone.slice(-4)}`
    : `Lead ${Date.now()}`;
}

/**
 * Auto-generated placeholder names we must not show to customers:
 *   "WhatsApp 2952"       — getOrCreateLead, last 4 phone digits
 *   "Lead 1720000000000"  — getOrCreateLead, Date.now() fallback
 *   "Lead 2952"           — disparo-planilha-create, last 4 phone digits
 */
const PLACEHOLDER_NAME_RE = /^(?:WhatsApp|Lead)\s+\d{3,}$/;

export function isPlaceholderLeadName(name: string | null | undefined): boolean {
  return !!name && PLACEHOLDER_NAME_RE.test(name.trim());
}

/**
 * Name safe to interpolate into customer-facing copy. Returns "" for
 * placeholder names so a greeting like "Boa tarde {{nome}}" collapses to a
 * neutral "Boa tarde" instead of leaking "Boa tarde WhatsApp 2952". Pair with
 * tidyEmptyVarGaps() to clean the punctuation the empty value leaves behind.
 */
export function personalizationName(name: string | null | undefined): string {
  return !name || isPlaceholderLeadName(name) ? "" : name;
}

/**
 * Primeiro nome seguro para copy voltada ao cliente — `{primeiro_nome}` /
 * `{{primeiro_nome}}`.
 *
 * Encadeia personalizationName(): nome-placeholder ("WhatsApp 2952") vira "",
 * nunca "WhatsApp". Fora isso, o primeiro token do nome:
 *
 *   "Lucia Pinheiro Da Silva" -> "Lucia"
 *   "LUCIA PINHEIRO"          -> "Lucia"   (caixa alta chega de Meta Ads/planilha;
 *                                           normalizar evita "Olá LUCIA!")
 *   "WhatsApp 2952"           -> ""
 *
 * Pareie com tidyEmptyVarGaps() quando o valor puder sair vazio.
 */
export function personalizationFirstName(name: string | null | undefined): string {
  const token = personalizationName(name).trim().split(/\s+/)[0] ?? "";
  if (!token) return "";

  const upper = token.toLocaleUpperCase("pt-BR");
  const lower = token.toLocaleLowerCase("pt-BR");
  // Só normaliza token inteiramente em caixa alta e que tenha letras.
  if (token.length > 1 && token === upper && upper !== lower) {
    return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
  }
  return token;
}

/**
 * Collapse the whitespace/punctuation gap left when an empty personalization
 * variable is removed from a resolved template:
 *   "Boa tarde , tudo bem?"     -> "Boa tarde, tudo bem?"
 *   "Oi !"                      -> "Oi!"
 *   ", seja bem-vindo"          -> "seja bem-vindo"
 * Only call this when a name was actually suppressed, to keep well-formed
 * templates byte-identical.
 */
export function tidyEmptyVarGaps(text: string): string {
  return text
    .replace(/[ \t]+([,.!?;:])/g, "$1") // space before punctuation
    .replace(/[ \t]{2,}/g, " ") // collapsed double spaces
    .replace(/^[ \t]*[,;:!?]+[ \t]*/gm, "") // orphan leading punctuation per line
    .replace(/[ \t]+$/gm, ""); // trailing spaces per line
}
