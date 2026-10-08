/**
 * Espelho de `public.normalize_brazilian_phone`: só dígitos, sem o 55, com o 9
 * no celular de 8 dígitos. É a chave de `lead_phones.normalized_phone` e de
 * `whatsapp_conversation_summary.normalized_phone` — comparar com qualquer
 * outra forma faria "5548999750303" e "48999750303" parecerem números distintos.
 */
export function normalizarTelefoneBr(phone: string | null | undefined): string {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 10) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d;
}
