/**
 * Prompt de sugestões de funcionalidade (primeira abertura do Torque).
 *
 * Regras puras, sem React nem Supabase: o que é elegível, o que é um texto
 * válido, que rota fica de fora. O componente e os hooks só orquestram.
 *
 * Banco: `supabase/migrations/20271122000001_feature_suggestions_first_run.sql`
 * (os CHECKs de lá e as constantes daqui precisam concordar).
 */

/** Chave do prompt em `user_prompt_impressions`. Trocar a chave = mostrar de novo para todos. */
export const FEATURE_SUGGESTION_PROMPT_KEY = "feature_suggestions_2026_10";

export const SUGGESTION_KINDS = ["feature", "improvement", "integration", "other"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export const SUGGESTION_KIND_LABEL: Record<SuggestionKind, string> = {
  feature: "Nova funcionalidade",
  improvement: "Melhoria",
  integration: "Integração",
  other: "Outro",
};

/**
 * Limites do texto. O banco (CHECK em feature_suggestions.body) exige 3 a 1000
 * caracteres no texto CRU, começando e terminando em não-espaço
 * (`[^[:space:]]`). O front é mais estrito: `normalizeBody` apara qualquer
 * espaço Unicode (`String#trim`) antes de medir e de enviar.
 */
export const BODY_MIN = 3;
export const BODY_MAX = 1000;

/** Caracteres que enchem o medidor de torque. */
export const TORQUE_IDEAL_LENGTH = 240;

export function normalizeBody(body: string): string {
  return body.trim();
}

export function isBodyValid(body: string): boolean {
  const length = normalizeBody(body).length;
  return length >= BODY_MIN && length <= BODY_MAX;
}

/**
 * Texto para leitor de tela perto do limite. Muda só ao cruzar um degrau
 * (100, 50, 0 restantes), então a região viva fala três vezes no máximo.
 */
export function limitAnnouncement(length: number): string {
  const remaining = BODY_MAX - length;
  if (remaining <= 0) return `Limite de ${BODY_MAX} caracteres atingido.`;
  if (remaining <= 50) return "Restam 50 caracteres ou menos.";
  if (remaining <= 100) return "Restam 100 caracteres ou menos.";
  return "";
}

/**
 * Onde o prompt nunca abre. O chat fica DENTRO de propósito: atendente que só
 * usa o chat também é usuário do Torque.
 */
const EXCLUDED_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/auth/,
  /^\/signup/,
  /^\/reset-password/,
  /^\/_mockup/,
  /^\/master/,
  /^\/tv/,
];

export function isExcludedRoute(pathname: string): boolean {
  return EXCLUDED_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

/** Outro diálogo do Radix aberto (modal, alerta, gaveta)? Então o prompt espera a vez. */
const OPEN_DIALOG_SELECTOR =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

export function isAnotherDialogOpen(root: ParentNode = document): boolean {
  return root.querySelector(OPEN_DIALOG_SELECTOR) !== null;
}
