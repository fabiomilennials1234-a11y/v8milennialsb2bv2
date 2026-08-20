/**
 * O ENVELOPE DE MÍDIA DO NOTIFICAME — fixado contra as DUAS fontes do fornecedor.
 *
 * Toda mídia foi recusada em produção (17/08/2026): áudio e imagem no Instagram
 * Direct voltaram "O NotificaMe recusou o envio da mensagem", enquanto texto
 * passava. A causa não era codec nem janela de 24h: o envelope que montávamos
 * não é o que a API pede.
 *
 *   nosso, antes:  { type: "image", url, caption }   /  { type: "audio", url }
 *   o do fornecedor: { type: "file", fileMimeType, fileUrl, fileCaption }
 *
 * `fileUrl`, `fileMimeType` e `fileCaption` não apareciam UMA VEZ no repo — o
 * envelope de mídia nunca tinha sido exercitado em canal nenhum.
 *
 * As duas fontes, que concordam byte a byte:
 *
 *   1. doc do fornecedor, `app.notificame.com.br/docs/api.md`;
 *   2. node oficial `n8n-nodes-notificame-hub@0.3.3`, em
 *      `dist/nodes/NotificaMeHub/transport/{instagram,whatsapp}/*.transport.js`.
 *
 * Os literais abaixo são cópia do node, não paráfrase. Se o fornecedor mudar,
 * é aqui que a mudança tem de doer primeiro.
 *
 * DUAS ASSIMETRIAS ENTRE CANAIS, ambas do fornecedor e ambas medidas:
 *
 *   • `voice: true` — o que faz o áudio chegar como GRAVAÇÃO e não como arquivo
 *     anexo — existe SÓ no WhatsApp. A doc não o traz em Instagram, Facebook,
 *     Telegram nem Mercado Livre, e o node oficial não o expõe em canal nenhum.
 *     No Direct, `fileMimeType: "audio"` é o mais nativo que o contrato permite.
 *   • `document` existe no WhatsApp e NÃO existe no Instagram: o node oferece
 *     Documento/Imagem/Vídeo no WhatsApp e só Imagem/Vídeo no Instagram.
 *     Recusamos aqui, como `sendTemplate` já faz — erro nosso, legível, antes
 *     do I/O, em vez da recusa opaca do fornecedor depois.
 */
import { describe, it, expect } from "vitest";

import {
  graphComponentsToTemplateComponents,
  toNotificameMediaContent,
} from "../../supabase/functions/_shared/whatsapp-providers/notificame-provider.ts";

const URL_OK = "https://exemplo.test/midia/arquivo.bin";

describe("WhatsApp — envelope de mídia", () => {
  it("imagem vira type:file + fileMimeType:image (literal do node oficial)", () => {
    const c = toNotificameMediaContent(
      { number: "5511999999999", type: "image", file: URL_OK, caption: "Olha isso" },
      "whatsapp",
    );
    expect(c).toEqual({
      type: "file",
      fileMimeType: "image",
      fileUrl: URL_OK,
      fileCaption: "Olha isso",
    });
  });

  it("vídeo idem, com fileMimeType:video", () => {
    const c = toNotificameMediaContent(
      { number: "5511999999999", type: "video", file: URL_OK },
      "whatsapp",
    );
    expect(c).toMatchObject({ type: "file", fileMimeType: "video", fileUrl: URL_OK });
  });

  it("documento usa fileMimeType:document — que só o WhatsApp tem", () => {
    const c = toNotificameMediaContent(
      { number: "5511999999999", type: "document", file: URL_OK, filename: "contrato.pdf" },
      "whatsapp",
    );
    expect(c).toMatchObject({ type: "file", fileMimeType: "document", fileUrl: URL_OK });
  });

  /**
   * ⚠️ CONTRATO REVISTO em 2026-08-19. Este teste afirmava que `audio` também
   * carrega `voice: true`, e era o comportamento — até a Meta recusar um m4a
   * marcado como nota de voz com `131053 Media upload error`.
   *
   * `voice: true` EXIGE .ogg/OPUS. Quem sabe o formato do arquivo é quem envia,
   * não este montador: `ptt` significa "é nota de voz, o chamador conferiu";
   * `audio` significa áudio comum. Ver `useNotificameWhatsAppSend`, que decide
   * entre os dois pelo MIME real.
   */
  it("áudio comum NÃO carrega voice — é anexo, não gravação", () => {
    const c = toNotificameMediaContent(
      { number: "5511999999999", type: "audio", file: URL_OK },
      "whatsapp",
    );
    expect(c).toEqual({
      type: "file",
      fileMimeType: "audio",
      fileUrl: URL_OK,
      fileCaption: "Áudio",
    });
  });

  it("ptt carrega voice:true — sem ele o WhatsApp entrega como ARQUIVO, não como gravação", () => {
    const c = toNotificameMediaContent(
      { number: "5511999999999", type: "ptt", file: URL_OK },
      "whatsapp",
    );
    expect(c).toMatchObject({ fileMimeType: "audio", voice: true });
  });
});

describe("Instagram — envelope de mídia", () => {
  it("imagem: mesmos campos, e NENHUM voice", () => {
    const c = toNotificameMediaContent(
      { number: "17841400000000000", type: "image", file: URL_OK, caption: "oi" },
      "instagram",
    );
    expect(c).toEqual({
      type: "file",
      fileMimeType: "image",
      fileUrl: URL_OK,
      fileCaption: "oi",
    });
    expect(c.voice).toBeUndefined();
  });

  it("áudio NÃO leva voice — o campo não existe neste canal", () => {
    const c = toNotificameMediaContent(
      { number: "17841400000000000", type: "audio", file: URL_OK },
      "instagram",
    );
    expect(c).toEqual({
      type: "file",
      fileMimeType: "audio",
      fileUrl: URL_OK,
      fileCaption: "Áudio",
    });
    expect(c.voice).toBeUndefined();
  });

  it("documento é recusado ANTES do I/O — o canal não o suporta", () => {
    expect(() =>
      toNotificameMediaContent(
        { number: "17841400000000000", type: "document", file: URL_OK, filename: "a.pdf" },
        "instagram",
      )
    ).toThrow(/document|arquivo/i);
  });
});

describe("recusas que já valiam e seguem valendo", () => {
  it("base64 embutido: o canal oficial exige URL pública", () => {
    expect(() =>
      toNotificameMediaContent(
        { number: "5511999999999", type: "image", file: "data:image/png;base64,iVBOR" },
        "whatsapp",
      )
    ).toThrow();
  });

  /**
   * STICKER — o `NotSupportedError` aqui nasceu de uma afirmação FALSA.
   *
   * O comentário do provider dizia "o canal oficial não tem figurinha" e que
   * mapeá-la seria adivinhar. A doc corrente do fornecedor tem uma seção inteira
   * chamada "Enviar um sticker", com envelope próprio:
   *
   *   { type:"file", fileMimeType:"sticker", fileUrl, fileCaption:"Sticker" }
   *
   * Não há nada a adivinhar: o campo existe e tem nome. É a mesma armadilha de
   * 2026-08-13, quando uma leitura do host desatualizado declarou inexistente o
   * endpoint de criação de subconta — ausência de evidência virou evidência de
   * ausência, e a asserção negativa entrou no código com ar de fato.
   */
  it("sticker vai no envelope de arquivo, com o mime que o fornecedor nomeia", () => {
    expect(
      toNotificameMediaContent(
        { number: "5511999999999", type: "sticker", file: URL_OK },
        "whatsapp",
      ),
    ).toEqual({
      type: "file",
      fileMimeType: "sticker",
      fileUrl: URL_OK,
      fileCaption: "Sticker",
    });
  });

  it("sticker continua fora do Instagram — lá a doc não o traz", () => {
    expect(() =>
      toNotificameMediaContent(
        { number: "17841400000000000", type: "sticker", file: URL_OK },
        "instagram",
      )
    ).toThrow();
  });

  it("nenhum envelope carrega os nomes ANTIGOS (url/caption soltos)", () => {
    const c = toNotificameMediaContent(
      { number: "5511999999999", type: "image", file: URL_OK, caption: "x" },
      "whatsapp",
    );
    // A regressão que produziu o incidente: `url` e `caption` no lugar de
    // `fileUrl` e `fileCaption`. O fornecedor aceita o corpo e recusa o envio.
    expect(c.url).toBeUndefined();
    expect(c.caption).toBeUndefined();
  });
});

/**
 * O LINK DA MÍDIA NO TEMPLATE — o defeito 132018.
 *
 * Na Graph o link vem ANINHADO sob a chave do tipo; o nosso
 * `TemplateSendParameter` o quer PLANO, e `buildSendParameter` lê `p.link`. O
 * repasse cru fazia esse campo chegar `undefined` — o JSON some com a chave e o
 * envelope sai assim:
 *
 *   {"type":"image","image":{}}
 *
 * Medido em produção (2026-08-19), como SEGUNDO erro do mesmo template: o
 * primeiro (132012) era o componente ausente, já corrigido, e este só apareceu
 * depois — a Meta valida uma coisa de cada vez.
 */
describe("graphComponentsToTemplateComponents — link da mídia", () => {
  it("achata o formato da Graph (aninhado) para o interno (plano)", () => {
    const [header] = graphComponentsToTemplateComponents([
      { type: "header", parameters: [{ type: "image", image: { link: "https://x/y.jpg" } }] },
    ]);

    expect(header.parameters?.[0]).toEqual({ type: "image", link: "https://x/y.jpg" });
  });

  it("aceita o formato plano de quem já mandava assim", () => {
    const [header] = graphComponentsToTemplateComponents([
      { type: "header", parameters: [{ type: "video", link: "https://x/y.mp4" }] },
    ]);

    expect(header.parameters?.[0]).toEqual({ type: "video", link: "https://x/y.mp4" });
  });

  it("documento também — os três tipos de mídia seguem a mesma regra", () => {
    const [header] = graphComponentsToTemplateComponents([
      { type: "header", parameters: [{ type: "document", document: { link: "https://x/y.pdf" } }] },
    ]);

    expect(header.parameters?.[0]).toEqual({ type: "document", link: "https://x/y.pdf" });
  });

  it("sem link em lugar nenhum, o campo fica VAZIO e não undefined", () => {
    // String vazia sobrevive ao JSON; `undefined` some, e some justamente a
    // chave que a Meta procura — foi assim que o erro apareceu como
    // "Either one of media ID or link must be present".
    const [header] = graphComponentsToTemplateComponents([
      { type: "header", parameters: [{ type: "image", image: {} }] },
    ]);

    expect(header.parameters?.[0]).toEqual({ type: "image", link: "" });
  });

  it("parâmetro de TEXTO passa intocado", () => {
    const [body] = graphComponentsToTemplateComponents([
      { type: "body", parameters: [{ type: "text", text: "Maria" }] },
    ]);

    expect(body.parameters?.[0]).toEqual({ type: "text", text: "Maria" });
  });
});
