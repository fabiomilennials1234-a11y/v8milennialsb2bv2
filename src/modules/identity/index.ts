/**
 * Module identity — API pública.
 *
 * Public surface do bounded context. Tudo cross-module passa por aqui.
 * Internals (subpastas) são privados — ESLint `boundaries` impede import direto.
 *
 * 🚧 Vazio — exports virão durante a slice 3 (`feat/modularizacao/02-identity`).
 * Ver `./CLAUDE.md` para escopo (auth + team + master + permissions),
 * entidade primária (Org + Team Member + Role + Permission) e áreas frágeis
 * (3 camadas de permissão + RLS multi-tenant + SECURITY DEFINER helpers).
 */

export {};
