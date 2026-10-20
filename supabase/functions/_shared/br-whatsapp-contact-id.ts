/**
 * A CHAVE do contato de WhatsApp — uma forma só para o mesmo número brasileiro.
 *
 * ─── o defeito que isto conserta ────────────────────────────────────────────
 *
 * A caixa do canal oficial agrupa a conversa por
 * `channel_messages.contact_external_id`. O CRM envia para o telefone do lead,
 * que tem o nono dígito (`5591999990000`); quando o cliente responde, a Meta
 * entrega o `wa_id` de números antigos SEM ele (`559199990000`). Duas strings
 * para a mesma pessoa = duas conversas na tela: a nossa mensagem numa, a
 * resposta na outra. Medido em prod em 2026-10-20: 247 contatos, 1.276
 * mensagens partidas, 100% NotificaMe.
 *
 * ─── a regra ────────────────────────────────────────────────────────────────
 *
 *   só dígitos; se forem 12, começarem com `55` e o primeiro dígito do
 *   assinante (índice 4) for 6–9 → insere `9` depois do DDD. Qualquer outra
 *   coisa sai como entrou (já sem enfeite).
 *
 *   | entrada         | saída           | por quê                         |
 *   |-----------------|-----------------|---------------------------------|
 *   | 559199990000    | 5591999990000   | celular sem o nono dígito       |
 *   | 5591999990000   | 5591999990000   | 13 dígitos — já canônico        |
 *   | 551133334444    | 551133334444    | FIXO (2–5) — não tem nono dígito|
 *   | 14155550123     | 14155550123     | não-BR                          |
 *
 * ─── por que NÃO reusar `public.normalize_br_mobile` / `normalize_brazilian_phone`
 *
 * As duas do banco põem o `9` em QUALQUER número de 10 dígitos após o DDD,
 * fixo inclusive (`551133334444` → `5511933334444`, número que não existe).
 * Como chave de agrupamento isso fundiria um fixo com um celular fantasma.
 * O critério do 5º dígito é o mesmo de `formatPhoneForWhatsApp` no front
 * (`src/modules/communication/lib/whatsappPhone.ts`), que monta a chave da
 * conversa sintética — por isso a conversa nova e a real casam.
 *
 * ─── por que 13 e não 12 ────────────────────────────────────────────────────
 *
 * 13 é a forma do cadastro (`leads.normalized_phone` = 11 com o 9) e a forma
 * que a Meta aceita como destinatário — o template `primeiro_contato_cadastro`
 * foi entregue a um número de 13 dígitos desses e a resposta voltou. Escolher 12 exigiria
 * TIRAR o 9, e tirar o 9 de um número que só existe com ele é perder o número.
 *
 * ⚠️ SÓ WHATSAPP. O IGSID do Instagram é opaco; quem chama decide o canal.
 *
 * Gêmea SQL: `public.canonical_br_whatsapp_id(text)` (migration do backfill).
 * Mudou aqui, muda lá — o teste de paridade lista os mesmos casos.
 */
export function canonicalBrWhatsappId(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("55") && /[6-9]/.test(digits[4])) {
    return `${digits.slice(0, 4)}9${digits.slice(4)}`;
  }
  return digits;
}
