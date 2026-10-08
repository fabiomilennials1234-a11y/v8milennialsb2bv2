// @vitest-environment node
/**
 * Encaminhar mensagem — regras do servidor (`_shared/whatsapp-forward.ts`).
 *
 * O que não pode quebrar:
 *  - a origem passa pelo guard de responsável (sem ele, quem não vê uma
 *    conversa copiaria o conteúdo para uma que vê);
 *  - mídia da CDN do WhatsApp nunca vai como URL (o destinatário receberia o
 *    arquivo criptografado): é baixada pelo chip da origem;
 *  - envio aceito nunca vira erro para o usuário (tentar de novo duplicaria).
 */
import { describe, it, expect, vi } from "vitest";
import {
  executeForward,
  isOwnStorageUrl,
  planForward,
  type ForwardDeps,
  type ForwardSource,
} from "../../supabase/functions/_shared/whatsapp-forward";

const SUPABASE_URL = "https://proj.supabase.co";
const STORAGE_URL = `${SUPABASE_URL}/storage/v1/object/public/media/whatsapp-media/org/x/foto.jpg`;
const CDN_URL = "https://mmg.whatsapp.net/v/t62.7118-24/abc.enc?mms3=true";

function source(over: Partial<ForwardSource> = {}): ForwardSource {
  return {
    id: "row-origem",
    instance_id: "chip-origem",
    message_id: "PROV-1",
    message_type: "text",
    content: "Segue o pedido",
    media_url: null,
    media_file_name: null,
    ...over,
  };
}

function deps(over: Partial<ForwardDeps> = {}): ForwardDeps {
  return {
    loadSource: vi.fn(async () => source()),
    canSeeSource: vi.fn(async () => true),
    downloadFromSource: vi.fn(async () => ({ base64: "QUJD", mimetype: "image/jpeg" })),
    sendText: vi.fn(async () => ({ success: true, messageId: "PROV-NOVO", status: "sent" })),
    sendMedia: vi.fn(async () => ({ success: true, messageId: "PROV-NOVO", status: "sent" })),
    persist: vi.fn(async () => {}),
    ...over,
  };
}

describe("isOwnStorageUrl", () => {
  it("aceita só o Storage público do próprio projeto", () => {
    expect(isOwnStorageUrl(STORAGE_URL, SUPABASE_URL)).toBe(true);
    expect(isOwnStorageUrl(CDN_URL, SUPABASE_URL)).toBe(false);
    expect(isOwnStorageUrl("https://evil.com/storage/v1/object/public/x.jpg", SUPABASE_URL)).toBe(false);
    expect(isOwnStorageUrl(`https://evil.com/?u=${STORAGE_URL}`, SUPABASE_URL)).toBe(false);
    expect(isOwnStorageUrl(null, SUPABASE_URL)).toBe(false);
  });
});

describe("planForward", () => {
  it("texto e `conversation` viram texto", () => {
    expect(planForward(source(), SUPABASE_URL)).toEqual({ kind: "text", text: "Segue o pedido" });
    expect(planForward(source({ message_type: "conversation" }), SUPABASE_URL).kind).toBe("text");
  });

  it("documento leva o nome original e a legenda", () => {
    const plan = planForward(
      source({ message_type: "document", media_url: STORAGE_URL, media_file_name: "pedido.pdf", content: "Pedido 42" }),
      SUPABASE_URL,
    );
    expect(plan).toEqual({ kind: "media", type: "document", url: STORAGE_URL, filename: "pedido.pdf", caption: "Pedido 42" });
  });

  it("mídia fora do nosso Storage pede download (url null)", () => {
    const plan = planForward(source({ message_type: "image", media_url: CDN_URL, content: null }), SUPABASE_URL);
    expect(plan).toEqual({ kind: "media", type: "image", url: null });
  });

  it("áudio não leva o texto de apoio como legenda", () => {
    const plan = planForward(source({ message_type: "ptt", media_url: STORAGE_URL, content: "transcrição" }), SUPABASE_URL);
    expect(plan).toEqual({ kind: "media", type: "ptt", url: STORAGE_URL });
  });

  it("localização, contato e texto vazio não são encaminháveis", () => {
    expect(planForward(source({ message_type: "location" }), SUPABASE_URL).kind).toBe("unsupported");
    expect(planForward(source({ message_type: "contact" }), SUPABASE_URL).kind).toBe("unsupported");
    expect(planForward(source({ content: "   " }), SUPABASE_URL).kind).toBe("unsupported");
  });
});

describe("executeForward", () => {
  it("origem inexistente (ou de outra org) → 404, sem envio", async () => {
    const d = deps({ loadSource: vi.fn(async () => null) });
    const out = await executeForward(d, SUPABASE_URL);
    expect(out.status).toBe(404);
    expect(d.sendText).not.toHaveBeenCalled();
  });

  it("origem que o usuário não pode ver → 403 chat_owner, sem envio", async () => {
    const d = deps({ canSeeSource: vi.fn(async () => false) });
    const out = await executeForward(d, SUPABASE_URL);
    expect(out).toEqual({ status: 403, body: { error: "Forbidden", reason: "chat_owner" } });
    expect(d.sendText).not.toHaveBeenCalled();
    expect(d.sendMedia).not.toHaveBeenCalled();
  });

  it("tipo não suportado → 422, sem envio", async () => {
    const d = deps({ loadSource: vi.fn(async () => source({ message_type: "location" })) });
    const out = await executeForward(d, SUPABASE_URL);
    expect(out.status).toBe(422);
    expect(d.sendText).not.toHaveBeenCalled();
  });

  it("texto: envia e grava a evidência ligada à origem", async () => {
    const d = deps();
    const out = await executeForward(d, SUPABASE_URL);
    expect(d.sendText).toHaveBeenCalledWith("Segue o pedido");
    expect(d.persist).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "PROV-NOVO", source: expect.objectContaining({ id: "row-origem" }) }),
    );
    expect(out).toEqual({ status: 200, body: { ok: true, result: { message_id: "PROV-NOVO", status: "sent" } } });
  });

  it("mídia do Storage vai como URL, sem baixar", async () => {
    const d = deps({
      loadSource: vi.fn(async () => source({ message_type: "image", media_url: STORAGE_URL, content: null })),
    });
    await executeForward(d, SUPABASE_URL);
    expect(d.downloadFromSource).not.toHaveBeenCalled();
    expect(d.sendMedia).toHaveBeenCalledWith({ type: "image", file: STORAGE_URL });
  });

  it("mídia da CDN do WhatsApp é baixada pelo chip da origem e vai em base64", async () => {
    const src = source({ message_type: "image", media_url: CDN_URL, content: null });
    const d = deps({ loadSource: vi.fn(async () => src) });
    await executeForward(d, SUPABASE_URL);
    expect(d.downloadFromSource).toHaveBeenCalledWith(src);
    expect(d.sendMedia).toHaveBeenCalledWith({ type: "image", file: "QUJD" });
  });

  it("download da origem falhou → 502 'indisponível', sem envio", async () => {
    const d = deps({
      loadSource: vi.fn(async () => source({ message_type: "image", media_url: CDN_URL })),
      downloadFromSource: vi.fn(async () => { throw new Error("404 from provider"); }),
    });
    const out = await executeForward(d, SUPABASE_URL);
    expect(out.status).toBe(502);
    expect(out.body).toMatchObject({ error: expect.stringContaining("indisponível") });
    expect(d.sendMedia).not.toHaveBeenCalled();
  });

  it("provider recusou → 502 com o motivo, sem gravar evidência", async () => {
    const d = deps({ sendText: vi.fn(async () => ({ success: false, error: "governor_block:quarantined" })) });
    const out = await executeForward(d, SUPABASE_URL);
    expect(out).toEqual({ status: 502, body: { error: "governor_block:quarantined" } });
    expect(d.persist).not.toHaveBeenCalled();
  });

  it("falha ao gravar a evidência depois do envio aceito NÃO vira erro", async () => {
    const d = deps({ persist: vi.fn(async () => { throw new Error("db down"); }) });
    const out = await executeForward(d, SUPABASE_URL);
    expect(out.status).toBe(200);
  });

  it("aceito sem id do provider → 200, sem tentar gravar evidência", async () => {
    const d = deps({ sendText: vi.fn(async () => ({ success: true })) });
    const out = await executeForward(d, SUPABASE_URL);
    expect(out).toEqual({ status: 200, body: { ok: true, result: { message_id: null } } });
    expect(d.persist).not.toHaveBeenCalled();
  });
});
