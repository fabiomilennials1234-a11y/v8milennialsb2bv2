/**
 * Handle do Instagram a partir do que o usuário cola.
 *
 * ESPELHA `lista_fria_busca_criar` (migration 20271217000000): o banco é quem
 * decide, esta função só avisa na tela antes de gastar uma ida ao servidor.
 * Aceita a URL do perfil (com ou sem www, barra final, query ou âncora) e o @
 * direto. URL de post, reel, explorar etc. não é conta.
 */

const NAO_E_CONTA = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "direct"]);
const HANDLE = /^[a-z0-9._]{1,30}$/;

export function extrairHandleDoInstagram(entrada: string): string | null {
  let h = entrada.trim().toLowerCase();
  h = h.replace(/^(https?:\/\/)?(www\.)?instagram\.com\//, "");
  h = h.replace(/^@/, "");
  h = h.split("?")[0].split("#")[0].split("/")[0];
  if (!HANDLE.test(h) || NAO_E_CONTA.has(h)) return null;
  return h;
}
