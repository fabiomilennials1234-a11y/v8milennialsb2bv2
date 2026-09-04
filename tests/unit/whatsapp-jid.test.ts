/**
 * Classificação de JID (telefone × grupo × LID) e resolução da conversa numa
 * mensagem de histórico.
 *
 * Nasceu do defeito visto na Café Jurerê em 2026-09-03: depois do backfill, o
 * inbox listou contatos chamados `210028246085780` — LIDs gravados como se
 * fossem telefone. Os testes abaixo fixam a regra nos dois sentidos: LID nunca
 * vira contato, e telefone legítimo nunca é descartado por causa dela.
 */
import { describe, it, expect } from "vitest";
import {
  isGroupJid,
  isLidJid,
  jidToPhone,
  resolveHistoryChatJid,
} from "../../supabase/functions/_shared/whatsapp-jid.ts";

describe("isLidJid / isGroupJid", () => {
  it("reconhece LID e grupo", () => {
    expect(isLidJid("210028246085780@lid")).toBe(true);
    expect(isLidJid("554791032199:23@lid")).toBe(true);
    expect(isGroupJid("120363041234567890@g.us")).toBe(true);
  });

  it("não confunde telefone com LID nem com grupo", () => {
    expect(isLidJid("5548999998888@s.whatsapp.net")).toBe(false);
    expect(isGroupJid("5548999998888@s.whatsapp.net")).toBe(false);
    expect(isLidJid(undefined)).toBe(false);
    expect(isGroupJid(null)).toBe(false);
  });
});

describe("jidToPhone", () => {
  it("aceita telefone com e sem sufixo", () => {
    expect(jidToPhone("5548999998888@s.whatsapp.net")).toBe("5548999998888");
    expect(jidToPhone("554899998888@c.us")).toBe("554899998888");
    expect(jidToPhone("5548999998888:12@s.whatsapp.net")).toBe("5548999998888");
    expect(jidToPhone("554899998888")).toBe("554899998888");
  });

  it("recusa grupo, LID e comprimento implausível", () => {
    expect(jidToPhone("120363041234567890@g.us")).toBeUndefined();
    expect(jidToPhone("210028246085780@lid")).toBeUndefined();
    // Um LID cru, sem sufixo, tem cara de número longo demais para E.164.
    expect(jidToPhone("2100282460857801")).toBeUndefined();
    expect(jidToPhone("123456789")).toBeUndefined();
    expect(jidToPhone(undefined)).toBeUndefined();
  });
});

describe("resolveHistoryChatJid", () => {
  it("usa o chatid quando ele é telefone", () => {
    expect(resolveHistoryChatJid({ chatid: "5548999998888@s.whatsapp.net" }))
      .toEqual({ kind: "phone", jid: "5548999998888@s.whatsapp.net" });
  });

  it("marca grupo como grupo", () => {
    expect(resolveHistoryChatJid({ chatid: "120363041234567890@g.us" }))
      .toEqual({ kind: "group" });
  });

  it("marca LID sem telefone no payload como não resolvido", () => {
    expect(resolveHistoryChatJid({ chatid: "210028246085780@lid" }))
      .toEqual({ kind: "unresolved_lid", lid: "210028246085780@lid" });
  });

  it("resolve LID pelo sender_pn (mesma escada do webhook)", () => {
    expect(resolveHistoryChatJid({
      chatid: "210028246085780@lid",
      sender_pn: "5548999998888@s.whatsapp.net",
    })).toEqual({ kind: "phone", jid: "5548999998888@s.whatsapp.net" });
  });

  it("prefere _phone_jid a qualquer outra pista", () => {
    expect(resolveHistoryChatJid({
      chatid: "210028246085780@lid",
      _phone_jid: "5511988887777@s.whatsapp.net",
      sender_pn: "5548999998888@s.whatsapp.net",
    })).toEqual({ kind: "phone", jid: "5511988887777@s.whatsapp.net" });
  });

  it("na mensagem recebida o outro lado é `from`", () => {
    expect(resolveHistoryChatJid({
      chatid: "210028246085780@lid",
      fromMe: false,
      from: "5548999998888@s.whatsapp.net",
      to: "5548111112222@s.whatsapp.net",
    })).toEqual({ kind: "phone", jid: "5548999998888@s.whatsapp.net" });
  });

  it("na mensagem enviada o outro lado é `to` — nunca o nosso próprio número", () => {
    expect(resolveHistoryChatJid({
      chatid: "210028246085780@lid",
      fromMe: true,
      from: "5548111112222@s.whatsapp.net", // nossa conta
      to: "5548999998888@s.whatsapp.net",
    })).toEqual({ kind: "phone", jid: "5548999998888@s.whatsapp.net" });
  });

  it("aceita as variantes de fromMe da Uazapi", () => {
    const payload = {
      chatid: "210028246085780@lid",
      from: "5548111112222@s.whatsapp.net",
      to: "5548999998888@s.whatsapp.net",
    };
    expect(resolveHistoryChatJid({ ...payload, fromme: true }))
      .toEqual({ kind: "phone", jid: "5548999998888@s.whatsapp.net" });
    expect(resolveHistoryChatJid({ ...payload, wa_fromMe: true }))
      .toEqual({ kind: "phone", jid: "5548999998888@s.whatsapp.net" });
  });

  it("não descarta JID de telefone fora do padrão — o defeito medido é o LID", () => {
    // Curto demais para `jidToPhone`, mas era gravado antes desta mudança e
    // nada em produção provou que deva sumir. Alargar o corte aqui é o tipo de
    // remoção cujo custo só aparece meses depois.
    expect(resolveHistoryChatJid({ chatid: "12345@s.whatsapp.net" }))
      .toEqual({ kind: "phone", jid: "12345@s.whatsapp.net" });
  });

  it("sem nenhum identificador, devolve missing", () => {
    expect(resolveHistoryChatJid({ text: "oi" })).toEqual({ kind: "missing" });
  });
});
