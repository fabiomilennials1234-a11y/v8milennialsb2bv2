/**
 * Quais requisições o cache de runtime do service worker pode assumir.
 *
 * Só as da própria aplicação. O `fetch` feito dentro do SW obedece à CSP do
 * `/sw.js`, que é a do app: para um host fora do `connect-src` (Cal.com, Meta) ele
 * falha e a página recebe erro, mesmo com a CSP da página permitindo. Foi assim
 * que a agenda das LPs ficou em "Carregando" para quem já tinha aberto o CRM.
 *
 * `/lp/` tem CSP própria e publicação independente do app; ao ficar fora do SW,
 * a landing page nunca é servida defasada.
 */
export const isLandingPath = (pathname: string): boolean =>
  pathname === "/lp" || pathname.startsWith("/lp/");

export const isAppOwnedRequest = (url: URL, workerOrigin: string): boolean =>
  url.origin === workerOrigin && !isLandingPath(url.pathname);

/**
 * Sonda do checkout. Quem não responde é um SW anterior a esta regra, que intercepta o Stripe.js e
 * o bloqueia (a Stripe fica fora do `connect-src` do `/sw.js` de propósito: código de pagamento não
 * entra em cache nosso).
 */
export const STRIPE_BYPASS_PROBE = "TORQUE_SW_STRIPE_BYPASS";
