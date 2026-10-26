/**
 * Telefones de UMA célula da planilha de importação.
 *
 * O lead tem vários telefones (`lead_phones`, ADR-0039), mas a importação só
 * guardava um: "(16)3234-1290, (16)99778-0380" virava o celular e o fixo se
 * perdia. Agora o primeiro "principal" segue a regra de sempre (celular antes de
 * fixo; empate mantém a ordem da célula) e os demais viram telefones extras do
 * lead. Espelho de `supabase/functions/import-leads/import-phones.ts`.
 */

/** Teto de extras por lead: célula com dezenas de números é lixo, não contato. */
export const MAX_EXTRA_PHONES = 9;

export interface PhoneCell {
  /** DDD + número (10-11 dígitos), o que vai em `leads.phone`. */
  primary?: string;
  /** Os demais números da célula, na ordem em que aparecem, sem repetir. */
  extras: string[];
}

/**
 * Quebra por separadores comuns (/, ;, vírgula, |, quebra de linha, " e ",
 * " ou "), reduz cada pedaço a dígitos, tira o 55 do país e mantém só os de
 * 10-11 dígitos. Notação científica do Excel ("7,1994E+10") é desfeita antes.
 */
export function parsePhoneCell(raw: string | undefined | null): PhoneCell {
  if (!raw) return { extras: [] };

  let work = String(raw).trim();
  const dotted = work.replace(",", ".");
  if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(dotted)) {
    const num = Number(dotted);
    if (!isNaN(num) && num > 0) work = Math.round(num).toString();
  }

  const seen = new Set<string>();
  const numbers: string[] = [];
  for (const chunk of work.split(/[/;,|\n]|\s+ou\s+|\s+e\s+/i)) {
    let digits = chunk.replace(/\D/g, "");
    if (!digits) continue;
    if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
      digits = digits.slice(2);
    }
    if (digits.length !== 10 && digits.length !== 11) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    numbers.push(digits);
  }
  if (numbers.length === 0) return { extras: [] };

  // Celular (11) antes de fixo (10); sort é estável, então o empate fica na ordem da célula.
  const primary = [...numbers].sort((a, b) => b.length - a.length)[0];
  return {
    primary,
    extras: numbers.filter((n) => n !== primary).slice(0, MAX_EXTRA_PHONES),
  };
}
