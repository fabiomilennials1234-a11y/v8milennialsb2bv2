/**
 * CPF/CNPJ: a mesma regra nos dois lados.
 *
 * `isValidBrDocument` é o espelho de `public.is_valid_br_document` (migration
 * 20271110000000): só dígitos, 11 ou 14, não uniforme, DV válido. A RPC
 * `set_lead_document` é quem decide; a tela valida antes só para não gastar
 * uma ida ao banco com o que já se sabe que vai voltar recusado.
 *
 * `sanitizeErpDocument` é a regra de `sanitizeDocument` do sync do Toth
 * (`supabase/functions/_shared/erp/toth-mappers.ts`): 11/14 dígitos, recusa
 * repetição uniforme, NÃO confere DV. É o filtro do valor que VEIO do ERP: o
 * Toth manda "00000000000000" quando não tem o documento, e isso não pode
 * aparecer na ficha como se fosse o CNPJ do cliente.
 */

export function onlyDigits(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\D/g, "")
    : "";
}

const UNIFORME = /^(\d)\1*$/;

function dv(digits: string, pesos: number[]): number {
  let soma = 0;
  for (let i = 0; i < pesos.length; i++) soma += Number(digits[i]) * pesos[i];
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

const CPF_1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
const CPF_2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** Recebe só dígitos; normalizar (`onlyDigits`) é trabalho de quem chama. */
export function isValidBrDocument(digits: string | null | undefined): boolean {
  if (!digits || !/^(\d{11}|\d{14})$/.test(digits) || UNIFORME.test(digits)) return false;
  if (digits.length === 11) {
    return dv(digits, CPF_1) === Number(digits[9]) && dv(digits, CPF_2) === Number(digits[10]);
  }
  return dv(digits, CNPJ_1) === Number(digits[12]) && dv(digits, CNPJ_2) === Number(digits[13]);
}

/** Documento vindo do ERP: placeholder e lixo viram `null`; DV não é conferido. */
export function sanitizeErpDocument(value: unknown): string | null {
  const digits = onlyDigits(value);
  if (digits.length !== 11 && digits.length !== 14) return null;
  if (UNIFORME.test(digits)) return null;
  return digits;
}

/** Máscara de exibição. O que não é CPF/CNPJ de tamanho certo volta como veio. */
export function formatBrDocument(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = onlyDigits(value);
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return value;
}
