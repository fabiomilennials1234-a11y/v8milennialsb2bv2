/**
 * uazapi-pix — monta o corpo do POST /send/pix-button da Uazapi.
 *
 * Correção 2026-07-27: a Uazapi rejeitava com "Missing required fields" porque
 * mandávamos os nomes internos (`pixkey`/`pixkeyType`/`merchantName`/`amount`).
 * A API espera **`pixKey`**, **`pixType`** (CPF/CNPJ/PHONE/EMAIL/EVP) e
 * **`pixName`** — e o pix-button NÃO tem campo de valor (o botão só carrega a
 * chave; WhatsApp não embute valor no botão de pix). Fonte: API/CLI Uazapi.
 */
import type { UazapiSendPixButtonInput } from "./uazapi-types.ts";

/** Tipo de chave interno → enum da Uazapi. `random` = chave aleatória (EVP). */
export const PIX_TYPE_MAP: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  phone: "PHONE",
  email: "EMAIL",
  random: "EVP",
};

export function buildPixButtonBody(input: UazapiSendPixButtonInput): Record<string, unknown> {
  const pixType = PIX_TYPE_MAP[input.pixkeyType] ?? String(input.pixkeyType).toUpperCase();
  return {
    number: input.number,
    pixKey: input.pixkey,
    pixType,
    pixName: input.merchantName,
    ...(input.text ? { text: input.text } : {}),
    ...(input.delay != null ? { delay: input.delay } : {}),
    ...(input.track_source ? { track_source: input.track_source } : {}),
    ...(input.track_id ? { track_id: input.track_id } : {}),
  };
}
