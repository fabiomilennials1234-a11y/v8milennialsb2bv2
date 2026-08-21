/**
 * Tests for _shared/crypto.ts — AES-256-GCM secret encryption. Key is passed in
 * (not read from env) so the module is pure and testable. Prior art:
 * shared-tinyerp-crypto.test.ts.
 *
 * O módulo saiu de `_shared/erp/crypto.ts` para `_shared/crypto.ts`: ele sempre
 * foi provider-neutral (recebe a chave por parâmetro) e agora tem um segundo
 * consumidor fora do ERP — `_shared/notificame-credentials.ts`, o cofre da
 * subconta do NotificaMe. Era só o CAMINHO, sob `erp/`, que mentia.
 *
 * O nome deste arquivo permanece `shared-erp-crypto` de propósito: renomeá-lo
 * junto com o move perderia o histórico do git por um ganho cosmético.
 */
import { describe, it, expect } from "vitest";
import {
  encryptSecret,
  decryptSecret,
} from "../../supabase/functions/_shared/crypto";

const KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("shared crypto — round trip", () => {
  it("decrypts back to the original secret", async () => {
    const { ciphertext, nonce } = await encryptSecret("app-secret-xyz", KEY_HEX);
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(await decryptSecret(ciphertext, nonce, KEY_HEX)).toBe("app-secret-xyz");
  });

  it("produces a fresh nonce and ciphertext per call", async () => {
    const a = await encryptSecret("same", KEY_HEX);
    const b = await encryptSecret("same", KEY_HEX);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("fails to decrypt with the wrong key", async () => {
    const { ciphertext, nonce } = await encryptSecret("app-secret-xyz", KEY_HEX);
    const otherKey =
      "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    await expect(decryptSecret(ciphertext, nonce, otherKey)).rejects.toThrow();
  });

  it("throws on a non-hex key", async () => {
    await expect(encryptSecret("x", "not-a-hex-key")).rejects.toThrow();
  });
});
