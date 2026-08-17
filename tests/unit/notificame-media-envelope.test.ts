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

  it("áudio carrega voice:true — sem ele o WhatsApp entrega como ARQUIVO, não como gravação", () => {
    const c = toNotificameMediaContent(
      { number: "5511999999999", type: "audio", file: URL_OK },
      "whatsapp",
    );
    expect(c).toEqual({
      type: "file",
      fileMimeType: "audio",
      fileUrl: URL_OK,
      fileCaption: "Áudio",
      voice: true,
    });
  });

  it("ptt (push-to-talk) é o mesmo caso do áudio", () => {
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

  it("sticker não é suportado", () => {
    expect(() =>
      toNotificameMediaContent(
        { number: "5511999999999", type: "sticker", file: URL_OK },
        "whatsapp",
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
