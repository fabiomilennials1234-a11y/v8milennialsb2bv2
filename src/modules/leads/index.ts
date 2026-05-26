/**
 * Module leads — API pública.
 *
 * Public surface do bounded context. Tudo cross-module passa por aqui.
 * Internals (subpastas) são privados — ESLint `boundaries` impede import direto.
 *
 * 🚧 Vazio — exports virão durante a slice 4 (`feat/modularizacao/03-leads`).
 * Ver `./CLAUDE.md` para escopo (CRUD lead, timeline, tags, scoring, import,
 * trash, duplicates), entidade primária (Lead), e dedup pendente
 * (useLeadHistory/Timeline/FieldChangelog/FieldChanges → consolidar).
 */

export {};
