/**
 * redactSecrets — mascaramento de telefone.
 *
 * `runtime_logs` guarda o `payload_snapshot` de edge functions. Um telefone ali
 * é PII de um *lead do nosso cliente* — não do nosso cliente. Redigir por
 * completo (`***REDACTED***`) inviabilizaria correlacionar um log a uma
 * conversa; deixar em claro é inaceitável. Mascaramos o miolo.
 */

import { describe, it, expect } from "vitest";
import { redactSecrets } from "../../supabase/functions/_shared/logger";

describe("redactSecrets — telefone", () => {
  it("masks the middle of a bare phone number", () => {
    expect(redactSecrets({ phone: "5511999992210" })).toEqual({ phone: "5511*****2210" });
  });

  it("masks the digits of a whatsapp jid, preserving the domain", () => {
    expect(redactSecrets({ remote_jid: "5511999992210@s.whatsapp.net" })).toEqual({
      remote_jid: "5511*****2210@s.whatsapp.net",
    });
  });

  it("masks a group jid", () => {
    const out = redactSecrets({ remote_jid: "120363012345678901@g.us" }) as Record<string, string>;
    expect(out.remote_jid).toMatch(/^1203\*+8901@g\.us$/);
  });

  it("masks canonical_phone and telefone alike", () => {
    expect(redactSecrets({ canonical_phone: "5511999992210" })).toEqual({
      canonical_phone: "5511*****2210",
    });
    expect(redactSecrets({ telefone: "5511999992210" })).toEqual({ telefone: "5511*****2210" });
  });

  it("is case-insensitive about the key name", () => {
    expect(redactSecrets({ Phone: "5511999992210" })).toEqual({ Phone: "5511*****2210" });
  });

  it("masks phones nested in arrays and objects", () => {
    expect(redactSecrets({ leads: [{ phone: "5511999992210" }] })).toEqual({
      leads: [{ phone: "5511*****2210" }],
    });
  });

  // Um número curto demais não tem miolo para mascarar sem revelar o todo.
  it("fully redacts a value too short to mask meaningfully", () => {
    expect(redactSecrets({ phone: "12345" })).toEqual({ phone: "***REDACTED***" });
  });

  it("fully redacts a non-string phone value", () => {
    expect(redactSecrets({ phone: 5511999992210 })).toEqual({ phone: "***REDACTED***" });
  });

  // Credencial vence telefone: uma chave que casa os dois é redigida por inteiro.
  it("prefers full redaction when the key is also a credential", () => {
    expect(redactSecrets({ phone_token: "5511999992210" })).toEqual({
      phone_token: "***REDACTED***",
    });
  });

  it("leaves non-phone keys untouched", () => {
    expect(redactSecrets({ lead_id: "5511999992210", count: 3 })).toEqual({
      lead_id: "5511999992210",
      count: 3,
    });
  });
});
