import { QUOTE_MAX_BYTES } from "../../../../src/contracts/copilot/quote-document.ts";
export function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export async function documentService(path: "inspect" | "render" | "health", body?: unknown) {
  const url = Deno.env.get("QUOTE_DOCUMENT_URL");
  const token = Deno.env.get("QUOTE_DOCUMENT_TOKEN");
  if (!url || !token || token.length < 32 || !url.startsWith("https://")) throw new Error("Serviço de documentos indisponível.");
  const response = await fetch(`${url.replace(/\/$/, "")}/${path}`, {
    method: body ? "POST" : "GET", redirect: "error",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Não foi possível processar o documento."); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Resposta vazia.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > QUOTE_MAX_BYTES * 1.5) { await reader.cancel(); throw new Error("Documento excede o limite."); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(output));
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
