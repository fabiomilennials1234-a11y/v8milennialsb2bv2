import { describe, it, expect } from "vitest";
import { formatPhoneForWhatsApp } from "../../src/modules/communication/lib/whatsapp";

describe("formatPhoneForWhatsApp", () => {
  it("returns null for undefined", () => {
    expect(formatPhoneForWhatsApp(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(formatPhoneForWhatsApp("")).toBeNull();
  });

  // Regression: a whitespace-only or non-numeric phone must NOT collapse to a
  // bare "55". Before the fix this produced "55", which Uazapi rejected with a
  // 500 that surfaced as "Edge Function returned a non-2xx status code".
  it("returns null for whitespace-only phone (bug: was emitting '55')", () => {
    expect(formatPhoneForWhatsApp("                 ")).toBeNull();
  });

  it("returns null for non-numeric garbage", () => {
    expect(formatPhoneForWhatsApp("no phone")).toBeNull();
  });

  it("returns null for a lone country code", () => {
    expect(formatPhoneForWhatsApp("55")).toBeNull();
  });

  it("returns null for a too-short number (missing DDD)", () => {
    expect(formatPhoneForWhatsApp("98765432")).toBeNull();
  });

  it("formats 11-digit BR phone with country code", () => {
    expect(formatPhoneForWhatsApp("11987654321")).toBe("5511987654321");
  });

  it("handles phone already with 55 prefix", () => {
    expect(formatPhoneForWhatsApp("5511987654321")).toBe("5511987654321");
  });

  it("removes non-numeric characters", () => {
    expect(formatPhoneForWhatsApp("+55 (11) 98765-4321")).toBe("5511987654321");
  });

  it("removes leading 0 from DDD", () => {
    expect(formatPhoneForWhatsApp("01198765432")).toBe("5511998765432");
  });

  it("adds 9 to 10-digit numbers (DDD + 8 digits)", () => {
    expect(formatPhoneForWhatsApp("1198765432")).toBe("5511998765432");
  });

  it("handles different DDDs", () => {
    expect(formatPhoneForWhatsApp("21987654321")).toBe("5521987654321");
  });

  it("handles short phone with 55 prefix", () => {
    expect(formatPhoneForWhatsApp("551198765432")).toBe("5511998765432");
  });

  // ── Regressão do chamado Mapila Alimentos (2026-07-29) ────────────────────
  // O código antigo concatenava "55" em qualquer coisa com 11 dígitos. Um
  // número que não pode ser celular BR virava um destino inexistente, e a
  // Uazapi respondia 500 "the number ... is not on WhatsApp" — que chegava no
  // operador como "Edge Function returned a non-2xx status code".

  it("rejects an 11-digit number whose subscriber part does not start with 9", () => {
    // Lead "Beto Maia": +14796612277 virava 5514796612277 e falhava na Uazapi
    expect(formatPhoneForWhatsApp("+14796612277")).toBeNull();
  });

  it("rejects a number with a non-existent area code", () => {
    // DDD 20 não existe no Brasil
    expect(formatPhoneForWhatsApp("20987654321")).toBeNull();
  });

  it("rejects a truncated number that used to pass as 11 digits", () => {
    expect(formatPhoneForWhatsApp("+55886130205")).toBeNull();
  });

  // ── DDD 55 (Santa Maria/RS) ───────────────────────────────────────────────
  // O código antigo decepava o "55" como se fosse sempre código de país,
  // sobrava 9 dígitos, caía no guard de tamanho e retornava null. 40 leads em
  // 13 orgs nunca conseguiram receber mensagem por causa disso.

  it("treats a leading 55 as area code when the length says it is local", () => {
    expect(formatPhoneForWhatsApp("55999998888")).toBe("5555999998888");
  });

  it("still treats a leading 55 as country code when the length requires it", () => {
    expect(formatPhoneForWhatsApp("5555999998888")).toBe("5555999998888");
  });

  it("handles DDD 55 written with an explicit country code", () => {
    expect(formatPhoneForWhatsApp("+55 (55) 99999-8888")).toBe("5555999998888");
  });

  it("is idempotent for an already-formatted number", () => {
    const once = formatPhoneForWhatsApp("11987654321");
    expect(formatPhoneForWhatsApp(once!)).toBe(once);
  });
});
