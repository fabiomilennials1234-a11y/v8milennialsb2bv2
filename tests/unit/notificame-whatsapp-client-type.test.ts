// @vitest-environment node
/**
 * O BACKSTOP DE ISOLAMENTO SOCIAL RECUSAVA O PRÓPRIO WHATSAPP OFICIAL.
 *
 * `whatsapp-client.ts` protege contra um canal de Instagram que tenha escapado
 * para `whatsapp_instances` — recusa quando `provider_config.channel_type` não é
 * de WhatsApp. A intenção é certa; a comparação é que estava crua:
 *
 *     declaredType !== "whatsapp" && declaredType !== "wa"   ← recusa
 *
 * Só que quem GRAVA esse campo é o `channel-finish`, com o valor que o fornecedor
 * declara em `/v1/channels` — e o canal oficial chega como
 * `whatsapp_business_account`. O backstop então recusava exatamente o caso que
 * deveria deixar passar.
 *
 * Medido em produção (Chique Distribuidora, 18/08/2026): a linha vinculada tem
 * `channel_type: "whatsapp_business_account"`, e é a PRIMEIRA `whatsapp_instances`
 * com `provider='notificame'` de toda a produção — o caminho de envio nunca tinha
 * sido exercitado. Todo envio dela morreria em
 * `is not a whatsapp channel (channel_type="whatsapp_business_account")`.
 *
 * `normalizeSeamlessType` já existia e já conhecia o alias — a mesma função que o
 * finish usa para escolher a TABELA. Faltava usá-la também aqui, no ponto que
 * decide se o envio sai.
 */
import { describe, it, expect } from "vitest";

// O predicado REAL do backstop, não uma cópia dele: um espelho aqui passaria
// verde com o bug em produção, que é exatamente o que aconteceu na primeira
// versão deste arquivo.
import { isNonWhatsAppChannelType } from "../../supabase/functions/_shared/whatsapp-client.ts";

const recusaria = isNonWhatsAppChannelType;

describe("backstop de isolamento social — o que passa", () => {
  it.each([
    ["whatsapp_business_account", "o vocabulário REAL do fornecedor"],
    ["whatsapp", "o nosso"],
    ["wa", "o abreviado"],
    ["WhatsApp_Business_Account", "caixa alta não muda o veredito"],
  ])("aceita %s (%s)", (tipo) => {
    expect(recusaria(tipo)).toBe(false);
  });

  it("campo ausente segue aceito — linha antiga sem o campo não pode quebrar", () => {
    expect(recusaria("")).toBe(false);
  });
});

describe("backstop de isolamento social — o que continua barrado", () => {
  it.each([["instagram"], ["ig"], ["facebook"], ["messenger"], ["telegram"], ["lixo"]])(
    "recusa %s",
    (tipo) => {
      expect(recusaria(tipo)).toBe(true);
    },
  );
});
