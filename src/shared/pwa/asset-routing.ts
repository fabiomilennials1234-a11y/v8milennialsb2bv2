/**
 * Quais ativos o Service Worker pode interceptar.
 *
 * `fetch` dentro do SW obedece ao `connect-src` do próprio /sw.js, não ao `script-src` da página.
 * Interceptar um host fora dessa lista é bloqueá-lo: foi o que derrubou o Stripe.js em toda volta
 * ao link de pagamento (ERR_FAILED, e nem recarregar resolvia). Por isso a regra é lista branca:
 * a própria origem, mais os dois hosts externos que o connect-src sempre permitiu. A Stripe fica
 * de fora de propósito: código de pagamento não entra em cache nosso.
 */
export const STRIPE_BYPASS_PROBE = "TORQUE_SW_STRIPE_BYPASS";

const ASSET_DESTINATIONS = new Set(["script", "style", "font", "image"]);

function isCachedExternalHost(hostname: string): boolean {
  return hostname.endsWith(".supabase.co") || hostname === "fonts.googleapis.com";
}

export function shouldCacheAsset({
  url,
  destination,
  selfOrigin,
}: {
  url: URL;
  destination: string;
  selfOrigin: string;
}): boolean {
  if (!ASSET_DESTINATIONS.has(destination)) return false;
  return url.origin === selfOrigin || isCachedExternalHost(url.hostname);
}
