// @vitest-environment node
/**
 * A janela de resposta do Direct, como INFORMAÇÃO — não como bloqueio.
 *
 * A doc do NotificaMe declara: "precisa estar dentro do período de mensagens
 * (até 24 horas após a última resposta do destinatário)".
 *
 * A decisão de produto foi NÃO impedir o envio por conta desse cálculo: o
 * relógio é nosso, a regra é da Meta, e travar o vendedor por causa de uma conta
 * que pode estar errada é pior do que deixá-lo tentar e ver a recusa. O que a
 * tela faz é MOSTRAR o tempo restante, sempre — a diferença entre "não consigo
 * responder" e "tenho 3 horas para responder".
 */
import { describe, it, expect } from "vitest";

import { socialReplyWindow } from "../../src/modules/communication/lib/social-window";

const AGORA = new Date("2026-08-17T18:00:00Z");
const h = (n: number) => new Date(AGORA.getTime() - n * 3_600_000).toISOString();

describe("socialReplyWindow — quanto tempo resta", () => {
  it("logo após a mensagem do cliente, resta quase tudo", () => {
    const j = socialReplyWindow(h(0.5), AGORA);

    expect(j.open).toBe(true);
    expect(j.label).toContain("23h");
  });

  it("mostra horas e minutos quando falta pouco", () => {
    const j = socialReplyWindow(h(22.5), AGORA);

    expect(j.open).toBe(true);
    expect(j.label).toContain("1h");
  });

  it("abaixo de uma hora, mostra os minutos — é quando o tempo importa", () => {
    const j = socialReplyWindow(h(23.5), AGORA);

    expect(j.open).toBe(true);
    expect(j.label).toContain("min");
  });

  it("passadas 24 horas, a janela fechou", () => {
    const j = socialReplyWindow(h(24.1), AGORA);

    expect(j.open).toBe(false);
    expect(j.label.toLowerCase()).toContain("encerr");
  });

  it("exatamente 24h já conta como fechada — a borda é do lado seguro", () => {
    expect(socialReplyWindow(h(24), AGORA).open).toBe(false);
  });

  it("sem mensagem recebida, não há janela para calcular", () => {
    // Thread só de saída (ou vazia): `null` significa "não sei", e a tela não
    // inventa contador. Mostrar '24h restantes' aqui seria uma conta sobre nada.
    expect(socialReplyWindow(null, AGORA).open).toBeNull();
    expect(socialReplyWindow(undefined, AGORA).open).toBeNull();
  });

  it("data ilegível também é 'não sei', nunca zero", () => {
    // Um timestamp corrompido virando "janela fechada" bloquearia a tela por um
    // defeito de dado — o oposto da decisão de não travar o operador.
    expect(socialReplyWindow("nao-e-data", AGORA).open).toBeNull();
  });

  it("timestamp no futuro não vira tempo negativo", () => {
    const futuro = new Date(AGORA.getTime() + 3_600_000).toISOString();
    const j = socialReplyWindow(futuro, AGORA);

    expect(j.open).toBe(true);
    expect(j.label).not.toContain("-");
  });
});
