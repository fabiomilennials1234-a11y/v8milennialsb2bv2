/**
 * Menção em grupo (Chamado 6885e65d). No grupo, o WhatsApp manda a menção como
 * texto `@<LID>` e a lista em `contextInfo.mentionedJID`; o chat mostrava o
 * número cru. Aqui travamos: LID com nome conhecido vira `@Nome`; sem nome, o
 * texto fica intacto; texto sem menção não é tocado.
 *
 * Fixtures fictícias — nenhum LID, nome ou telefone de cliente.
 */
import { describe, it, expect } from "vitest";
import {
  buildMentionNameMap,
  collectMentionedJids,
  readMentionedJids,
  readSenderLid,
  splitMentions,
} from "./groupMentions";

const ANA = "11111111111111@lid";
const BETO = "222222222222222@lid";
const nomes = new Map([[ANA, "Ana Teste"]]);

describe("splitMentions", () => {
  it("LID resolvido vira @Nome", () => {
    expect(splitMentions("@11111111111111 oi", [ANA], nomes)).toEqual([
      { kind: "mention", jid: ANA, raw: "@11111111111111", name: "Ana Teste" },
      { kind: "text", text: " oi" },
    ]);
  });

  it("LID sem nome conhecido mantém o número intacto", () => {
    const segs = splitMentions("@11111111111111 @222222222222222 confere?", [ANA, BETO], nomes);
    expect(segs).toEqual([
      { kind: "mention", jid: ANA, raw: "@11111111111111", name: "Ana Teste" },
      { kind: "text", text: " " },
      { kind: "mention", jid: BETO, raw: "@222222222222222", name: null },
      { kind: "text", text: " confere?" },
    ]);
    // Concatenando o que é desenhado, o número sem nome sai exatamente como veio.
    expect(segs.map((s) => (s.kind === "text" ? s.text : s.name ? `@${s.name}` : s.raw)).join("")).toBe(
      "@Ana Teste @222222222222222 confere?",
    );
  });

  it("texto sem @ é devolvido intocado, num segmento só", () => {
    expect(splitMentions("frete FOB, ok", [ANA], nomes)).toEqual([{ kind: "text", text: "frete FOB, ok" }]);
  });

  it("sem mentionedJID nada vira menção — nem um @número parecido", () => {
    expect(splitMentions("@11111111111111 oi", [], nomes)).toEqual([{ kind: "text", text: "@11111111111111 oi" }]);
  });

  it("não casa prefixo de um número maior nem e-mail", () => {
    const segs = splitMentions("@111111111111119 e a@11111111111111", [ANA], nomes);
    expect(segs.filter((s) => s.kind === "mention")).toEqual([]);
  });

  it("menção no meio e no fim da legenda, repetida", () => {
    const segs = splitMentions("confirma o pix @11111111111111? valeu @11111111111111", [ANA], nomes);
    expect(segs.filter((s) => s.kind === "mention").map((s) => s.kind === "mention" && s.name)).toEqual([
      "Ana Teste",
      "Ana Teste",
    ]);
    expect(segs[0]).toEqual({ kind: "text", text: "confirma o pix " });
    expect(segs[2]).toEqual({ kind: "text", text: "? valeu " });
  });
});

describe("readMentionedJids — projeção do SELECT OU raw_payload do Realtime", () => {
  it("lê a projeção uazapi_mentioned_jids", () => {
    expect(readMentionedJids({ uazapi_mentioned_jids: [ANA, BETO] })).toEqual([ANA, BETO]);
  });

  it("lê o raw_payload completo que chega pelo Realtime (texto e legenda de mídia)", () => {
    const raw = { content: { contextInfo: { mentionedJID: [ANA] } } };
    expect(readMentionedJids({ raw_payload: raw })).toEqual([ANA]);
  });

  it("projeção tem precedência sobre raw_payload", () => {
    const raw = { content: { contextInfo: { mentionedJID: [BETO] } } };
    expect(readMentionedJids({ uazapi_mentioned_jids: [ANA], raw_payload: raw })).toEqual([ANA]);
  });

  it("descarta lixo e duplicata", () => {
    expect(readMentionedJids({ uazapi_mentioned_jids: [ANA, ANA, 42, "x@lid", "1@g.us", null] })).toEqual([ANA]);
    expect(readMentionedJids({ uazapi_mentioned_jids: "nope" })).toEqual([]);
    expect(readMentionedJids({})).toEqual([]);
  });

  it("menção citada (dentro de quotedMessage) não conta — é do texto citado, não desta mensagem", () => {
    const raw = {
      content: { contextInfo: { quotedMessage: { imageMessage: { contextInfo: { mentionedJID: [ANA] } } } } },
    };
    expect(readMentionedJids({ raw_payload: raw })).toEqual([]);
  });
});

describe("buildMentionNameMap — quem escreveu no grupo empresta o nome à menção", () => {
  it("monta lid → push_name pela projeção ou pelo raw_payload; o mais recente vence", () => {
    const map = buildMentionNameMap([
      { uazapi_sender_lid: ANA, push_name: "Ana Antigo" },
      { raw_payload: { sender_lid: BETO }, push_name: "  Beto Teste " },
      { uazapi_sender_lid: ANA, push_name: "Ana Teste" },
    ]);
    expect(map.get(ANA)).toBe("Ana Teste");
    expect(map.get(BETO)).toBe("Beto Teste");
  });

  it("ignora remetente sem nome e sender_lid que não é LID", () => {
    const map = buildMentionNameMap([
      { uazapi_sender_lid: ANA, push_name: "  " },
      { uazapi_sender_lid: "5548999990000@s.whatsapp.net", push_name: "Fulano" },
      { uazapi_sender_lid: BETO, push_name: null },
    ]);
    expect(map.size).toBe(0);
  });

  it("readSenderLid aceita projeção ou raw_payload", () => {
    expect(readSenderLid({ uazapi_sender_lid: ANA })).toBe(ANA);
    expect(readSenderLid({ raw_payload: { sender_lid: BETO } })).toBe(BETO);
    expect(readSenderLid({ raw_payload: { sender_lid: "nope" } })).toBeNull();
  });
});

describe("collectMentionedJids", () => {
  it("junta os LIDs mencionados na thread, sem repetir", () => {
    expect(
      collectMentionedJids([
        { uazapi_mentioned_jids: [ANA] },
        { raw_payload: { content: { contextInfo: { mentionedJID: [ANA, BETO] } } } },
        { push_name: "Sem Menção", uazapi_mentioned_jids: null },
      ]),
    ).toEqual([ANA, BETO]);
  });
});
