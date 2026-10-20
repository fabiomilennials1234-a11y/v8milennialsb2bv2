// @vitest-environment node
/**
 * A chave canônica do contato de WhatsApp — e os dois escritores que a usam.
 *
 * O defeito (medido em prod em 2026-10-20): o envio gravava `5591999990000`
 * (telefone do lead, com o nono dígito) e a resposta chegava da Meta como
 * `559199990000`. A caixa agrupa por `contact_external_id`, e a mesma pessoa
 * virava duas conversas — 247 contatos, 1.276 mensagens.
 *
 * O que fica provado aqui:
 *   1. a regra pura (celular 12→13, fixo / 13 / não-BR intactos, enfeite fora);
 *   2. os DOIS escritores produzem a MESMA chave para as duas formas;
 *   3. Instagram não é tocado;
 *   4. a gêmea SQL da migration de backfill dá o mesmo resultado que a TS,
 *      caso a caso (PGlite — Postgres de verdade, em memória).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

import { canonicalBrWhatsappId } from "../../supabase/functions/_shared/br-whatsapp-contact-id.ts";
import { buildInboundChannelMessageRow } from "../../supabase/functions/_shared/notificame-inbound.ts";
import { buildOutboundChannelMessageRow } from "../../supabase/functions/_shared/whatsapp-providers/notificame-provider.ts";

const COM_9 = "5591999990000";
const SEM_9 = "559199990000";

/** Os casos que a TS e a SQL precisam concordar. [entrada, esperado] */
const CASOS: Array<[string | null, string, string]> = [
  [SEM_9, COM_9, "celular 12 dígitos ganha o nono dígito"],
  [COM_9, COM_9, "13 dígitos fica intacto"],
  ["554884334050", "5548984334050", "celular começando em 8"],
  ["551166667777", "5511966667777", "celular começando em 6 (limite inferior)"],
  ["551133334444", "551133334444", "fixo (5º dígito 3) intacto — onde normalize_br_mobile erra"],
  ["551123334444", "551123334444", "fixo (5º dígito 2) intacto"],
  ["551153334444", "551153334444", "fixo (5º dígito 5, limite superior) intacto"],
  ["14155550123", "14155550123", "não-BR (EUA) intacto"],
  ["447911123456", "447911123456", "não-BR de 12 dígitos intacto"],
  ["+55 (91) 9999-0000", COM_9, "+, espaço, parêntese e hífen saem antes da regra"],
  ["+55 91 99999-0000", COM_9, "13 com enfeite fica só dígitos"],
  ["", "", "vazio"],
  [null, "", "nulo"],
];

describe("canonicalBrWhatsappId — a regra pura", () => {
  it.each(CASOS)("%s → %s (%s)", (entrada, esperado) => {
    expect(canonicalBrWhatsappId(entrada)).toBe(esperado);
  });

  it("é idempotente: aplicar duas vezes não muda nada", () => {
    for (const [entrada] of CASOS) {
      const uma = canonicalBrWhatsappId(entrada);
      expect(canonicalBrWhatsappId(uma)).toBe(uma);
    }
  });
});

// ─── Os dois escritores ──────────────────────────────────────────────────────

const outbound = (to: string, channelKind: "whatsapp" | "instagram" = "whatsapp") =>
  buildOutboundChannelMessageRow({
    organizationId: "org-1",
    channelKind,
    instanceId: channelKind === "whatsapp" ? "wi-1" : null,
    messagingChannelId: channelKind === "instagram" ? "mc-1" : null,
    contactExternalId: to,
    externalId: "out-1",
    messageType: "text",
    content: "olá",
    mediaUrl: null,
    timestampIso: "2026-10-20T16:17:00.000Z",
    rawPayload: {},
  });

const inbound = (from: string, kind: "whatsapp" | "instagram" = "whatsapp") =>
  buildInboundChannelMessageRow({
    organizationId: "org-1",
    target: kind === "whatsapp"
      ? { kind: "whatsapp", instanceId: "wi-1" }
      : { kind: "instagram", messagingChannelId: "mc-1" },
    externalId: "in-1",
    contact: { externalId: from, name: "Fulano", handle: null, avatarUrl: null },
    contactExternalId: from,
    content: { messageType: "text", content: "oi", mediaUrl: null },
    timestampIso: "2026-10-20T16:21:00.000Z",
    rawPayload: {},
  });

describe("os dois escritores gravam a MESMA chave", () => {
  it("envio com 13 e resposta com 12 caem na mesma conversa (o caso medido em prod)", () => {
    const saida = outbound(COM_9);
    const entrada = inbound(SEM_9);
    expect(saida.contact_external_id).toBe(COM_9);
    expect(entrada.contact_external_id).toBe(COM_9);
    expect(saida.phone_number).toBe(COM_9);
    expect(entrada.phone_number).toBe(COM_9);
  });

  it("e o inverso também: envio com 12 e resposta com 13", () => {
    expect(outbound(SEM_9).contact_external_id).toBe(COM_9);
    expect(inbound(COM_9).contact_external_id).toBe(COM_9);
  });

  it("enfeite vindo do compositor não muda a chave", () => {
    expect(outbound("+55 (91) 9999-0000").contact_external_id).toBe(COM_9);
  });

  it("fixo continua fixo nos dois sentidos", () => {
    expect(outbound("551133334444").contact_external_id).toBe("551133334444");
    expect(inbound("551133334444").contact_external_id).toBe("551133334444");
  });

  it("inbound guarda o wa_id CRU em sender_id — é quem mandou, não a chave", () => {
    expect(inbound(SEM_9).sender_id).toBe(SEM_9);
  });
});

describe("Instagram NÃO é tocado — o IGSID é opaco", () => {
  // Um IGSID de 12 dígitos começando com 55 e 5º dígito 6–9 seria "corrigido"
  // se a regra vazasse para o Instagram.
  const IGSID = "559199990000";

  it("outbound mantém o id cru e phone_number nulo", () => {
    const row = outbound(IGSID, "instagram");
    expect(row.contact_external_id).toBe(IGSID);
    expect(row.phone_number).toBeNull();
  });

  it("inbound mantém o id cru e phone_number nulo", () => {
    const row = inbound(IGSID, "instagram");
    expect(row.contact_external_id).toBe(IGSID);
    expect(row.phone_number).toBeNull();
  });
});

// ─── Paridade com a gêmea SQL do backfill ────────────────────────────────────

describe("paridade TS × SQL (public.canonical_br_whatsapp_id)", () => {
  it("a função da migration dá o mesmo resultado em todos os casos", async () => {
    const sql = readFileSync(
      path.resolve(
        __dirname,
        "../../supabase/migrations/20271208000000_chave_canonica_whatsapp_oficial.sql",
      ),
      "utf8",
    );
    // Só o CREATE FUNCTION: o resto da migration precisa das tabelas de prod.
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.canonical_br_whatsapp_id[\s\S]*?\$\$;/);
    expect(fn, "CREATE FUNCTION não encontrado na migration").not.toBeNull();

    const db = new PGlite();
    try {
      await db.exec(fn![0]);
      for (const [entrada, esperado, motivo] of CASOS) {
        const { rows } = await db.query<{ v: string }>(
          "SELECT public.canonical_br_whatsapp_id($1) AS v",
          [entrada],
        );
        expect(rows[0].v, motivo).toBe(esperado);
        expect(rows[0].v, `TS diverge: ${motivo}`).toBe(canonicalBrWhatsappId(entrada));
      }
    } finally {
      await db.close();
    }
  }, 30_000);
});
