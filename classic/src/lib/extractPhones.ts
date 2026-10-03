/**
 * Extrator de telefones brasileiros dentro de texto livre.
 *
 * Lê o que a pessoa digitou no chat (Instagram, WhatsApp) e devolve os números
 * mencionados, já normalizados pela mesma regra de `leads.normalized_phone`,
 * junto do trecho cru — a evidência que o vendedor confere na tela.
 *
 * É deliberadamente conservador: o consumidor deste módulo sugere ao humano
 * que dois leads são a mesma pessoa, e o ICP (fábrica/distribuidora B2B) manda
 * CNPJ, CPF, CEP, valor e código de pedido no chat o tempo todo. Falso negativo
 * custa uma sugestão que não aparece; falso positivo custa confiança na tela.
 */

import { normalizePhone } from "./normalizePhone";

export interface PhoneCandidate {
  /** Telefone normalizado, mesma forma de `leads.normalized_phone`. */
  normalized: string;
  /** Trecho exato como apareceu no texto — evidência citável ao humano. */
  raw: string;
  /**
   * `true` quando o número tinha 10 dígitos e a normalização inseriu o nono
   * dígito. Com `kind: "landline"` isso é perigoso: `(11) 3456-7890` (fixo)
   * vira `11934567890`, indistinguível do celular `11 93456-7890` de outra
   * pessoa — casamento por esse candidato exige evidência adicional. Com
   * `kind: "mobile"` a inserção reconstrói o número atual do formato antigo.
   */
  inferredNinthDigit: boolean;
  /** O que o número era ANTES da normalização, pelo prefixo do assinante. */
  kind: "mobile" | "landline";
}

/**
 * Sequência com cara de telefone BR: código do país opcional, DDD, nono dígito
 * opcional (podendo vir separado do resto), e o miolo.
 *
 * O regex é deliberadamente permissivo — ele só acha candidatos. Quem recusa é
 * a validação abaixo. Regex que já recusa esconde a regra: a guarda deixa de
 * ser alcançável e nenhum teste consegue provar que ela funciona.
 */
const PHONE_RE = /(?:\+?\s?55[\s.-]?)?\(?\d{2}\)?[\s.-]?(?:9[\s.-]?)?\d{4,5}[\s.-]?\d{4}/g;

/** DDDs que existem no Brasil (Anatel). Fora desta lista não é telefone. */
const VALID_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/** Primeiro dígito possível num fixo brasileiro. */
const LANDLINE_FIRST_DIGITS = new Set(["2", "3", "4", "5"]);

/**
 * Primeiro dígito de celular no formato antigo (DDD + 8 dígitos, pré-migração
 * do nono dígito). Ficam de fora os prefixos 6 e 7, que existiram em algumas
 * UFs e hoje geram mais ruído do que acerto.
 */
const LEGACY_MOBILE_FIRST_DIGITS = new Set(["8", "9"]);

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

/**
 * Dígitos do trecho, sem o código do país — mesma regra de `normalizePhone`,
 * para que a validação enxergue exatamente o número que será normalizado.
 */
function localDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 12 && digits.startsWith("55") ? digits.slice(2) : digits;
}

/**
 * Classifica o assinante (número sem DDD) pelo prefixo. `null` = não é
 * telefone brasileiro plausível.
 */
function classify(subscriber: string): PhoneCandidate["kind"] | null {
  // Celular atual: 9 dígitos, sempre começando em 9.
  if (subscriber.length === 9) return subscriber.startsWith("9") ? "mobile" : null;
  if (LANDLINE_FIRST_DIGITS.has(subscriber[0])) return "landline";
  if (LEGACY_MOBILE_FIRST_DIGITS.has(subscriber[0])) return "mobile";
  return null;
}

export function extractPhoneCandidates(text: string | null | undefined): PhoneCandidate[] {
  if (!text) return [];

  const found: PhoneCandidate[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(PHONE_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;

    // Recorte de um número maior (CPF, CNPJ, código de pedido) não é telefone.
    if (isDigit(text[start - 1]) || isDigit(text[start + raw.length])) continue;

    const digits = localDigits(raw);
    if (digits.length !== 10 && digits.length !== 11) continue;

    const ddd = Number(digits.slice(0, 2));
    if (!VALID_DDD.has(ddd)) continue;

    const subscriber = digits.slice(2);
    const kind = classify(subscriber);
    if (!kind) continue;

    // Dígito repetido é placeholder, não telefone.
    if (new Set(subscriber).size === 1) continue;

    const normalized = normalizePhone(raw);
    if (!normalized || seen.has(normalized)) continue;

    seen.add(normalized);
    found.push({ normalized, raw, inferredNinthDigit: subscriber.length === 8, kind });
  }

  return found;
}
