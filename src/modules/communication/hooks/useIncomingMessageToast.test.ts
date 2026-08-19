/**
 * Qual caixa o aviso de mensagem recebida abre.
 *
 * A regra vivia dentro do callback do Realtime, sem teste, e descartava a caixa
 * de WhatsApp oficial em silêncio: a conversa entrava na lista e ninguém era
 * avisado. Este arquivo existe para que a próxima caixa não repita isso — o
 * defeito não dá erro, dá ausência.
 */
import { describe, expect, it } from "vitest";

import { toastBoxId } from "./useIncomingMessageToast";

const CANAL_IG = "11111111-1111-1111-1111-111111111111";
const INSTANCIA = "7312692e-b9b4-4f90-aba3-09cff992bbfc";

describe("toastBoxId", () => {
  it("Instagram do NotificaMe abre pela caixa social", () => {
    expect(
      toastBoxId({ channel: "instagram", messaging_channel_id: CANAL_IG }),
    ).toBe(CANAL_IG);
  });

  it("canal oficial abre pela INSTÂNCIA — o eixo dele", () => {
    expect(
      toastBoxId({
        channel: "whatsapp",
        instance_id: INSTANCIA,
        messaging_channel_id: null,
      }),
    ).toBe(INSTANCIA);
  });

  it("rota Meta/Graph fica de fora — grava instagram sem canal e não tem caixa", () => {
    expect(
      toastBoxId({ channel: "instagram", messaging_channel_id: null }),
    ).toBeNull();
  });

  it("linha de whatsapp sem instância fica de fora — é o fóssil da era Evolution", () => {
    expect(toastBoxId({ channel: "whatsapp", instance_id: null })).toBeNull();
  });

  it("canal desconhecido fica de fora — aviso que leva a lugar nenhum é pior que nenhum", () => {
    expect(toastBoxId({ channel: "telegram", instance_id: INSTANCIA })).toBeNull();
    expect(toastBoxId({})).toBeNull();
  });
});
