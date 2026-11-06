/**
 * Marca "paguei nesta aba", para quem recarrega depois do `succeeded` e antes do webhook não
 * ver o formulário de novo. Sem PII, e a chave leva 8 hex do sha256: nunca o token.
 */
async function markKey(token: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return `torque-checkout-paid:${hex.slice(0, 8)}`;
  } catch {
    return null;
  }
}

export async function readPaidMark(token: string): Promise<boolean> {
  const key = await markKey(token);
  if (!key) return false;
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export async function writePaidMark(token: string): Promise<void> {
  const key = await markKey(token);
  if (!key) return;
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Storage bloqueado: quem recarregar cai no POST, que responde already_paid.
  }
}

const REDIRECT_PARAMS = ["payment_intent", "payment_intent_client_secret", "redirect_status"];

/** Pura, para o StrictMode poder chamar duas vezes. Quem limpa a URL é `clearRedirectParams`. */
export function readRedirectSecret(search: string): string | null {
  return new URLSearchParams(search).get("payment_intent_client_secret");
}

/** O client_secret não fica na URL nem no histórico. */
export function clearRedirectParams(): void {
  const url = new URL(window.location.href);
  if (!REDIRECT_PARAMS.some((p) => url.searchParams.has(p))) return;
  for (const p of REDIRECT_PARAMS) url.searchParams.delete(p);
  window.history.replaceState(window.history.state, "", url.pathname + url.search);
}
