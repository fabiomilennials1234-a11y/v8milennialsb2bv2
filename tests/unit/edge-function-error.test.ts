import { describe, it, expect } from "vitest";
import {
  extractEdgeFunctionError,
  friendlyWhatsAppSendError,
  whatsAppSendErrorMessage,
} from "../../src/modules/communication/lib/edgeFunctionError";

/**
 * Reproduz o formato de erro do supabase-js v2: `.message` sempre genérico,
 * motivo real escondido no `Response` de `.context`.
 */
function functionsHttpError(body: unknown) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: { json: async () => body },
  };
}

describe("extractEdgeFunctionError", () => {
  it("reads the real message from the response body instead of the generic one", async () => {
    const err = functionsHttpError({
      error: "Uazapi server error 500 on POST /send/text: the number 5514796612277@s.whatsapp.net is not on WhatsApp",
    });
    await expect(extractEdgeFunctionError(err)).resolves.toContain("is not on WhatsApp");
  });

  it("falls back to body.message when there is no body.error", async () => {
    await expect(
      extractEdgeFunctionError(functionsHttpError({ message: "boom" })),
    ).resolves.toBe("boom");
  });

  it("falls back to text() when the body is not JSON", async () => {
    const err = {
      message: "Edge Function returned a non-2xx status code",
      context: {
        json: async () => {
          throw new Error("not json");
        },
        text: async () => "plain text failure",
      },
    };
    await expect(extractEdgeFunctionError(err)).resolves.toBe("plain text failure");
  });

  it("falls back to error.message when there is no context at all", async () => {
    await expect(extractEdgeFunctionError(new Error("network down"))).resolves.toBe("network down");
  });

  it("never throws on a null error", async () => {
    await expect(extractEdgeFunctionError(null)).resolves.toBe("Erro desconhecido");
  });
});

describe("friendlyWhatsAppSendError", () => {
  it("translates the Uazapi 'not on WhatsApp' 500 into an actionable message", () => {
    const raw =
      "Uazapi server error 500 on POST /send/text: the number 5514796612277@s.whatsapp.net is not on WhatsApp";
    expect(friendlyWhatsAppSendError(raw)).toBe(
      "Esse número não tem WhatsApp. Confira o telefone no cadastro do lead.",
    );
  });

  it("translates the phone parse failure", () => {
    expect(
      friendlyWhatsAppSendError("Uazapi server error 500 on POST /send/text: could not parse phone number: 55"),
    ).toContain("Número de telefone inválido");
  });

  it("passes through the proxy's own pt-BR 422 unchanged", () => {
    const raw = "Número de telefone inválido ou ausente para este contato.";
    expect(friendlyWhatsAppSendError(raw)).toBe(raw);
  });

  it("translates the WhatsApp 463 temporary restriction — the Distetica case", () => {
    const raw =
      "Uazapi server error 500 on POST /send/text: error sending message: WhatsApp server error 463: WhatsApp reported that the currently connected account is under a temporary restriction for starting new conversations, usually related to sending volume or quality.";
    const friendly = friendlyWhatsAppSendError(raw);
    expect(friendly).toContain("bloqueou temporariamente");
    expect(friendly).toContain("pare os disparos");
    expect(friendly).not.toContain("Uazapi");
  });

  /**
   * Carol Distribuidora, 2026-08-05: os 4 envios que deram 463 FORAM entregues
   * (reapareceram no history sync com o timestamp original). O vendedor leu
   * "não enviada", reenviou, e dois leads receberam a mensagem duplicada.
   * A microcópia tem de frear o reenvio antes de explicar o bloqueio.
   */
  it("warns that the 463 message may already have been delivered — before anything else", () => {
    const raw =
      "Uazapi server error 500 on POST /send/text: error sending message: WhatsApp server error 463: temporary restriction for starting new conversations";
    const friendly = friendlyWhatsAppSendError(raw);
    expect(friendly).toContain("pode ter sido entregue");
    expect(friendly).toContain("antes de reenviar");
    // o aviso precisa vir primeiro: é a única parte que muda o que a pessoa faz agora
    expect(friendly.indexOf("pode ter sido entregue")).toBeLessThan(
      friendly.indexOf("bloqueou temporariamente"),
    );
  });

  it("warns about ambiguous delivery on an unmapped Uazapi 5xx", () => {
    const friendly = friendlyWhatsAppSendError(
      "Uazapi server error 502 on POST /send/media: bad gateway",
    );
    expect(friendly).toContain("pode ter sido entregue");
  });

  it("warns about ambiguous delivery on a timeout", () => {
    expect(friendlyWhatsAppSendError("timeout after 15000ms on POST /send/text")).toContain(
      "pode ter sido entregue",
    );
  });

  /**
   * O circuit breaker abre ANTES da requisição sair, então aqui dizer "pode ter
   * sido entregue" seria mentira — e mentira que trava um reenvio legítimo.
   */
  it("does NOT warn about delivery when the circuit breaker blocked the request", () => {
    const friendly = friendlyWhatsAppSendError(
      "Circuit breaker open for /send/text until 2026-08-03T18:47:55.882Z",
    );
    expect(friendly).not.toContain("pode ter sido entregue");
    expect(friendly).toContain("não chegou a sair");
  });

  it("keeps the deterministic 'not on WhatsApp' case free of the ambiguity warning", () => {
    // chega como 500 igual aos ambíguos, mas aqui sabemos que NÃO foi entregue
    const friendly = friendlyWhatsAppSendError(
      "Uazapi server error 500 on POST /send/text: the number 5514796612277@s.whatsapp.net is not on WhatsApp",
    );
    expect(friendly).not.toContain("pode ter sido entregue");
  });

  it("does not mistake a phone number containing 463 for the restriction error", () => {
    const raw =
      "Uazapi server error 500 on POST /send/text: the number 5511994635555@s.whatsapp.net is not on WhatsApp";
    expect(friendlyWhatsAppSendError(raw)).toBe(
      "Esse número não tem WhatsApp. Confira o telefone no cadastro do lead.",
    );
  });

  it("passes unknown errors through instead of swallowing them", () => {
    expect(friendlyWhatsAppSendError("something nobody mapped yet")).toBe(
      "something nobody mapped yet",
    );
  });
});

describe("whatsAppSendErrorMessage", () => {
  it("unwraps and translates in one step — the Mapila case end to end", async () => {
    const err = functionsHttpError({
      error: "Uazapi server error 500 on POST /send/text: the number 5514796612277@s.whatsapp.net is not on WhatsApp",
    });
    await expect(whatsAppSendErrorMessage(err)).resolves.toBe(
      "Esse número não tem WhatsApp. Confira o telefone no cadastro do lead.",
    );
  });

  it("never surfaces the generic supabase-js string when a body exists", async () => {
    const err = functionsHttpError({ error: "instance is not connected" });
    await expect(whatsAppSendErrorMessage(err)).resolves.not.toContain("non-2xx");
  });
});
