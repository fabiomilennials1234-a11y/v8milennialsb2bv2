/**
 * Module marketing — API pública.
 *
 * Public surface do bounded context (captura pública de leads + tracking de origem).
 * Tudo cross-module passa por aqui. Internals (components/, pages/) são privados —
 * ESLint `boundaries` impede import direto fora da API pública.
 *
 * Status: Active (populado em slice 13 — feat/modularizacao/12-billing-marketing).
 *
 * Domínios cobertos:
 * - Landing page pública (Hero, Showcase, Pricing, FAQ, Footer, etc.)
 * - UTM tracking + Mkt Origin display (consumido por analytics)
 * - Cadastro externo (endpoint público pra n8n/Meta Ads/Zapier)
 * - Animations da landing
 *
 * Pages NÃO são re-exportadas — App.tsx faz deep-import via React.lazy
 * (padrão dos slices 4-12):
 *   @/modules/marketing/pages/Landing (rota `/`)
 *
 * Components da landing NÃO são re-exportados — consumidos apenas pela Landing
 * page do próprio módulo. Mkt* components SÃO re-exportados pois são consumidos
 * por analytics (AquisicaoSection) — dependência cross-module documentada.
 */

// ────────────────────────────────────────────────────────────────────────
// Hooks — Landing animations + Cadastro externo
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useLandingAnimations";
export * from "./hooks/useCadastroExterno";

// ────────────────────────────────────────────────────────────────────────
// Components — Marketing (Mkt* consumidos por analytics.AquisicaoSection)
// ────────────────────────────────────────────────────────────────────────

export { MktConfigModal } from "./components/marketing/MktConfigModal";
export { MktOriginCard } from "./components/marketing/MktOriginCard";
export { MktOriginRanking } from "./components/marketing/MktOriginRanking";
export { MktUtmBreakdown } from "./components/marketing/MktUtmBreakdown";
