/**
 * O primeiro contato pela caixa de WhatsApp oficial.
 *
 * Medido em produção (19/08): clicar em "Iniciar conversa por → Chiquê" no funil
 * levava ao chat e não abria nada. A conversa não estava escondida — ela não
 * existia, porque a lista da caixa oficial vem de uma RPC que só devolve quem já
 * trocou mensagem.
 */
import { describe, expect, it } from "vitest";

import { chaveDeConversaOficial, contatoDeConversaNova } from "./official-conversation";

const INSTANCIA = "7312692e-b9b4-4f90-aba3-09cff992bbfc";

describe("chaveDeConversaOficial", () => {
  it("normaliza o telefone do CRM e monta a chave da caixa", () => {
    expect(chaveDeConversaOficial(INSTANCIA, "47992176628"))
      .toBe(`whatsapp_oficial:${INSTANCIA}:5547992176628`);
  });

  it("aceita o telefone como o usuário digitou", () => {
    expect(chaveDeConversaOficial(INSTANCIA, "(47) 99217-6628"))
      .toBe(`whatsapp_oficial:${INSTANCIA}:5547992176628`);
  });

  it("põe o nono dígito no formato antigo — é o mesmo número", () => {
    expect(chaveDeConversaOficial(INSTANCIA, "4788334050"))
      .toBe(`whatsapp_oficial:${INSTANCIA}:5547988334050`);
  });

  it("recusa o que não é celular brasileiro, em vez de abrir conversa morta", () => {
    // Abrir para um número que a Meta vai recusar é empurrar a falha para depois
    // do texto digitado.
    // ⚠️ Número de 10 dígitos NÃO entra nesta lista: o produto inteiro insere o
    // nono dígito nesse formato (ver o caso acima). O que sobra é o que nem
    // assim vira celular — 11 dígitos com terceiro diferente de 9, curto demais,
    // ou DDD que não existe.
    for (const ruim of ["", "123", "47833344449", "0012345678", null, undefined]) {
      expect(chaveDeConversaOficial(INSTANCIA, ruim)).toBeNull();
    }
  });

  it("sem instância não há chave", () => {
    expect(chaveDeConversaOficial(null, "47992176628")).toBeNull();
  });
});

describe("contatoDeConversaNova", () => {
  const chave = `whatsapp_oficial:${INSTANCIA}:5547992176628`;

  it("monta o contato que a tela precisa para abrir o composer", () => {
    const c = contatoDeConversaNova(chave, INSTANCIA, "Flavionei Silva");

    expect(c).toMatchObject({
      channel: "whatsapp_oficial",
      conversation_key: chave,
      messaging_channel_id: INSTANCIA,
      external_user_id: "5547992176628",
      display_name: "Flavionei Silva",
      unread_count: 0,
    });
  });

  it("sem mensagem, a prévia é null — não é 'Nova conversa'", () => {
    // Inventar texto aqui faria a lista lateral exibi-lo como se fosse a última
    // mensagem trocada.
    const c = contatoDeConversaNova(chave, INSTANCIA);
    expect(c?.last_message).toBeNull();
    expect(c?.last_message_direction).toBeNull();
  });

  it("RECUSA chave de outra caixa — é o que impede conversa endereçada ao canal errado", () => {
    const outraInstancia = "0000aaaa-0000-0000-0000-000000000000";

    expect(contatoDeConversaNova(chave, outraInstancia)).toBeNull();
    expect(contatoDeConversaNova(`instagram:${INSTANCIA}:17841400000000000`, INSTANCIA)).toBeNull();
  });

  it("chave sem interlocutor não vira contato", () => {
    expect(contatoDeConversaNova(`whatsapp_oficial:${INSTANCIA}:`, INSTANCIA)).toBeNull();
    expect(contatoDeConversaNova(null, INSTANCIA)).toBeNull();
    expect(contatoDeConversaNova(chave, null)).toBeNull();
  });

  it("nome em branco não vira nome", () => {
    const c = contatoDeConversaNova(chave, INSTANCIA, "   ");
    expect(c?.display_name).toBeNull();
    expect(c?.lead_name).toBeNull();
  });
});
