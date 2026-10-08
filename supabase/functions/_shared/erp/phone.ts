/**
 * Normalização de telefone brasileiro — espelho EXATO de
 * `public.normalize_brazilian_phone` (Postgres).
 *
 * Existe aqui, e não importado de `_shared/lead-service.ts`, porque o mapper e o
 * planejador de telefones do ERP são lógica pura testada sem banco: puxar o
 * lead-service arrastaria o supabase-js para dentro deles. As duas cópias são
 * travadas pelo mesmo teste de paridade (shared-erp-toth-mappers.test.ts).
 *
 * É a chave de `lead_phones (lead_id, normalized_phone)`: se divergir do banco,
 * o sync acharia "telefone novo" onde o banco vê duplicata.
 */
export function normalizeBrazilianPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned === "") return null;
  if (cleaned.length >= 12 && cleaned.startsWith("55")) cleaned = cleaned.slice(2);
  if (cleaned.length === 10) cleaned = `${cleaned.slice(0, 2)}9${cleaned.slice(2)}`;
  return cleaned;
}
