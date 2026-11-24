// Runs against classic/src through vitest.classic.config.ts.
import { describe, expect, it } from "vitest";
import { friendlyWhatsAppSendError } from "@/modules/communication/lib/edgeFunctionError";

// Carol Distribuidora, 2026-11-24 (classic UI): number logged out, the seller
// read raw provider text or a breaker message in English.
describe("friendlyWhatsAppSendError (classic)", () => {
  it("translates the raw Uazapi 503 of a logged-out number", () => {
    const raw = "Uazapi server error 503 on POST /send/text: WhatsApp disconnected: session is not reconnectable";
    expect(friendlyWhatsAppSendError(raw)).toBe(
      "A instância do WhatsApp está desconectada. Reconecte em Configurações > WhatsApp.",
    );
  });

  it("translates the raw circuit-breaker message and says nothing was sent", () => {
    const friendly = friendlyWhatsAppSendError("Circuit breaker open for /send/text until 2026-11-24T11:46:36.277Z");
    expect(friendly).toContain("não foi enviada");
    expect(friendly).not.toContain("Circuit");
  });

  it("passes the proxy's own pt-BR 409 refusal unchanged", () => {
    const raw =
      "Este número do WhatsApp está desconectado e a mensagem não foi enviada. Reconecte o número em Configurações > WhatsApp e envie de novo.";
    expect(friendlyWhatsAppSendError(raw)).toBe(raw);
  });
});
