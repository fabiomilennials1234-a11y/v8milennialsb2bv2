/**
 * O que este arquivo guarda é a TRADUÇÃO do campo do interlocutor entre dois
 * contratos que usam nomes diferentes para a mesma coisa — `contactExternalId`
 * na rota social, `to` na rota de WhatsApp. Os dois são `string`: trocá-los não
 * é erro de tipo, é mensagem enviada para lugar nenhum.
 */
import { describe, expect, it, vi } from "vitest";

import { directSender, officialWhatsAppSender } from "./social-sender";

const mutation = () => ({
  isPending: false,
  mutateAsync: vi.fn().mockResolvedValue({ ok: true }),
});

describe("directSender", () => {
  it("repassa o input intacto — a rota social já fala esse contrato", async () => {
    const m = mutation();
    await directSender(m).send({ contactExternalId: "17841400000000000", text: "oi" });

    expect(m.mutateAsync).toHaveBeenCalledWith({
      contactExternalId: "17841400000000000",
      text: "oi",
    });
  });
});

describe("officialWhatsAppSender", () => {
  it("traduz contactExternalId para `to`", async () => {
    const m = mutation();
    await officialWhatsAppSender(m).send({
      contactExternalId: "554884334050",
      text: "oi",
    });

    expect(m.mutateAsync).toHaveBeenCalledWith({
      to: "554884334050",
      text: "oi",
      media: undefined,
    });
  });

  it("leva a mídia junto — anexo é v1 nesta caixa (Q7)", async () => {
    const m = mutation();
    await officialWhatsAppSender(m).send({
      contactExternalId: "554884334050",
      media: { type: "image", url: "https://storage.example/a.jpg", filename: "a.jpg" },
    });

    expect(m.mutateAsync).toHaveBeenCalledWith({
      to: "554884334050",
      text: undefined,
      media: { type: "image", url: "https://storage.example/a.jpg", filename: "a.jpg" },
    });
  });

  it("NUNCA manda `contactExternalId` para a rota de WhatsApp", async () => {
    const m = mutation();
    await officialWhatsAppSender(m).send({
      contactExternalId: "554884334050",
      text: "oi",
    });

    expect(m.mutateAsync.mock.calls[0][0]).not.toHaveProperty("contactExternalId");
  });

  it("propaga isPending — é o que desabilita o botão enquanto envia", () => {
    expect(officialWhatsAppSender({ ...mutation(), isPending: true }).isPending).toBe(true);
  });
});
