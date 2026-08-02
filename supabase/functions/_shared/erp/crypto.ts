/**
 * AES-256-GCM encryption for ERP credentials (provider-neutral).
 *
 * The key is passed in as hex (32 bytes / 64 hex chars) rather than read from
 * the environment, so this module is pure and testable and each ERP can carry
 * its own key env. Ciphertext and nonce are returned base64-encoded for storage.
 */

// `Uint8Array<ArrayBuffer>`, não `Uint8Array` pelado: desde o TS 5.7 o tipo é
// genérico e `Uint8Array` sozinho vale `Uint8Array<ArrayBufferLike>`, que inclui
// `SharedArrayBuffer` e por isso NÃO satisfaz `BufferSource` do WebCrypto. Os
// valores aqui saem todos de `new Uint8Array(...)`, que já é respaldado por um
// `ArrayBuffer` comum — a anotação frouxa é que apagava essa informação e
// derrubava `importKey`/`decrypt`. Nada muda em runtime.
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const pairs = hex.match(/.{2}/g);
  if (!pairs || pairs.length * 2 !== hex.length) {
    throw new Error("Invalid encryption key: expected hex");
  }
  return new Uint8Array(
    pairs.map((b) => {
      const n = parseInt(b, 16);
      if (Number.isNaN(n)) throw new Error("Invalid encryption key: expected hex");
      return n;
    }),
  );
}

function base64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64Decode(str: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    atob(str)
      .split("")
      .map((c) => c.charCodeAt(0)),
  );
}

async function importKey(keyHex: string, usage: KeyUsage): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    hexToBytes(keyHex),
    { name: "AES-GCM" },
    false,
    [usage],
  );
}

export async function encryptSecret(
  plaintext: string,
  keyHex: string,
): Promise<{ ciphertext: string; nonce: string }> {
  const key = await importKey(keyHex, "encrypt");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: base64Encode(new Uint8Array(encrypted)),
    nonce: base64Encode(nonce),
  };
}

export async function decryptSecret(
  ciphertext: string,
  nonce: string,
  keyHex: string,
): Promise<string> {
  const key = await importKey(keyHex, "decrypt");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Decode(nonce) },
    key,
    base64Decode(ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}
