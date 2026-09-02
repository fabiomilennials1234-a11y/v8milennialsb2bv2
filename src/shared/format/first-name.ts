/**
 * first-name.ts — espelho de `supabase/functions/_shared/lead-name.ts` para a
 * prévia no CRM bater com o que o motor de envio produz.
 *
 * Mantenha as duas cópias em sincronia: `tests/unit/first-name-variable.test.ts`
 * roda as mesmas asserções contra ambas.
 */

/**
 * Nomes-placeholder gerados quando o lead nasce sem nome real:
 *   "WhatsApp 2952"       — getOrCreateLead, 4 últimos dígitos do telefone
 *   "Lead 1720000000000"  — getOrCreateLead, fallback Date.now()
 *   "Lead 2952"           — disparo-planilha-create
 */
const PLACEHOLDER_NAME_RE = /^(?:WhatsApp|Lead)\s+\d{3,}$/;

export function isPlaceholderLeadName(name: string | null | undefined): boolean {
  return !!name && PLACEHOLDER_NAME_RE.test(name.trim());
}

/** Nome seguro para copy voltada ao cliente — placeholder vira "". */
export function personalizationName(name: string | null | undefined): string {
  return !name || isPlaceholderLeadName(name) ? "" : name;
}

/**
 * Primeiro nome seguro — `{primeiro_nome}` / `{{primeiro_nome}}`.
 *
 *   "Lucia Pinheiro Da Silva" -> "Lucia"
 *   "LUCIA PINHEIRO"          -> "Lucia"   (caixa alta chega de Meta Ads/planilha)
 *   "WhatsApp 2952"           -> ""        (nunca "WhatsApp")
 */
export function personalizationFirstName(name: string | null | undefined): string {
  const token = personalizationName(name).trim().split(/\s+/)[0] ?? "";
  if (!token) return "";

  const upper = token.toLocaleUpperCase("pt-BR");
  const lower = token.toLocaleLowerCase("pt-BR");
  if (token.length > 1 && token === upper && upper !== lower) {
    return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
  }
  return token;
}
