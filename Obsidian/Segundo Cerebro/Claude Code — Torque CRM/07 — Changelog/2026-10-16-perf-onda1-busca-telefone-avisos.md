---
type: changelog
title: Perf onda 1 — busca de telefone em Leads e polling do sino
status: in-progress
created: 2026-10-16
updated: 2026-10-16
tags: [changelog, perf, leads, avisos, supabase]
related: []
owner: claude-agent
---

# 2026-10-16 — Perf onda 1: busca de telefone em Leads e polling do sino

Contexto: RAM do Supabase em 83% e pool do PostgREST (25) saturando em rajadas.
`lead_phones ilike` = 10,6% do tempo do banco (1.041 ms/chamada); polling de
`notifications` = 8,5% (81,5 chamadas/min).

## Mudanças
- **Leads (busca)**: input responde na hora; o termo que vai às queries espera 300 ms (`useDebounce`).
- **Leads (telefone secundário)**: `buscarLeadIdsPorTelefoneSecundario(queryClient, org, termo)` passa por `fetchQuery`, chave `["lead-phones-busca-secundaria", org, dígitos]`, staleTime 60 s. Lista + contagens + modal de pipe = 1 consulta por (org, dígitos), não 6. Erro degrada para `[]` e não fica em cache. Salvar/nomear telefone invalida a raiz.
- **Avisos (sino)**: canal `joined` → sonda de 5 min (postgres_changes pode descartar evento com canal de pé); degradado → 30 s; nunca em background; receptor relê ao voltar à aba (`refetchOnWindowFocus: "always"`) e sempre que o canal chega a `joined` vindo de outro estado — inclusive o 1º join da montagem (fecha a janela entre a fotografia da consulta e o canal subir). A releitura só conta com fotografia iniciada DEPOIS do join (relógio lógico); com consulta em voo, espera ela terminar e relê — `invalidateQueries` sozinho reaproveitaria a promessa em voo quando o cache está vazio (TanStack 5.83).
- **DB**: `lead_phones_normalized_phone_trgm_idx` (GIN trigrama parcial `deleted_at IS NULL`) e `notifications_recipient_org_recent_idx (user_id, organization_id, last_event_at DESC NULLS LAST)`. Sem trigrama em `leads.normalized_phone`: o braço está num OR com colunas sem índice, não mudaria o plano.

## Arquivos tocados
- `src/modules/leads/pages/Leads.tsx`, `src/modules/leads/hooks/{useLeads,useLeadPhones}.ts`
- `src/modules/pipelines/components/custom/AddLeadToPipeModal.tsx`
- `src/modules/platform/hooks/useAvisos.ts`, `src/modules/platform/lib/rede-de-seguranca-de-avisos.ts`
- `supabase/migrations/20271123000000_perf_indices_busca_telefone_e_avisos.sql` (+ rollback)
- Testes: `src/modules/leads/hooks/useLeads.busca-secundaria.test.tsx`, `src/modules/leads/pages/Leads.busca-debounce.test.tsx`, `src/modules/platform/hooks/useAvisos.test.tsx`, `src/modules/platform/lib/rede-de-seguranca-de-avisos.test.ts`, `tests/integration/perf-indices-busca-telefone-e-avisos.test.mjs` (PGlite)

## Decisões
- CREATE INDEX sem CONCURRENTLY, com `SET LOCAL lock_timeout = '3s'`: migration roda em transação; tabelas pequenas (prod 16/10: lead_phones 70.363 linhas / 11 MB heap; notifications 47.413 linhas / 60 MB total).
- `notifications_recipient_org_unread_idx` fica: serve `marcarTodosComoLidos` (`read_at IS NULL`).
- `useReconcileInterval` não reusado: é do chat (lê o status de canal do WhatsApp).

## Follow-ups
- Nada aplicado em prod, nada deployado. Migration antes do front é indiferente (índices não mudam contrato).
