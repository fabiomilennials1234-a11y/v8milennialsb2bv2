---
type: changelog
title: Watch channel do Google Calendar deixa de se multiplicar
status: active
created: 2026-11-16
updated: 2026-11-16
tags: [changelog, agenda, google-calendar, incidente, performance]
related: ["[[Agenda Interna]]"]
owner: claude-agent
---

# 2026-11-16 — Watch channel do Google Calendar deixa de se multiplicar

## Mudanças
- **Causa-raiz do incidente de 2026-11-16 (09:10 BRT)**: o webhook renovava o canal a partir de qualquer notificação perto da expiração (lida do header) e criava canal novo sem parar o antigo. N canais vivos → N webhooks por mudança → N canais novos. Um usuário chegou a 3.108 canais; rajada de 24 mil req REST em 5 min, kanban p95 8,7 s.
- **Banco**: índice único parcial `uq_watch_channels_active_user_calendar` (1 ativo por user/calendar) + RPC `replace_google_watch_channel` (SECURITY INVOKER, só service_role) que troca o canal ativo de forma atômica: compare-and-swap na renovação, substitui todos na reconexão OAuth, `unique_violation` vira `won=false`.
- **Edge**: `registerWatchChannel` cria o canal no Google, chama o RPC e para no Google os canais trocados (venceu) ou o recém-criado (perdeu). Webhook renova só pela `expiration` do banco e passa o `channel_id` da notificação como esperado.

## Arquivos tocados
- `supabase/migrations/20280116000000_google_watch_channel_unico.sql` + `rollback/` — índice, RPC, grants (só schema, nenhum DML; com duplicata ativa o índice falha alto)
- `supabase/functions/_shared/google-calendar-utils.ts` — `registerWatchChannel` via RPC, `stopGoogleChannel`, `watchChannelNeedsRenewal`
- `supabase/functions/google-calendar-webhook/index.ts` — SELECT traz `expiration`; renovação por CAS
- `src/integrations/supabase/types.ts` — assinatura do RPC
- `tests/unit/shared-google-calendar.test.ts`, `tests/unit/google-calendar-webhook.test.ts`, `tests/unit/google-watch-channel-replace.test.ts` (PGlite), `tests/unit/google-calendar-watch-burst.test.ts` (handler real + RPC real em PGlite: rajada K=50 → 1 ativo; 3.000 canais mortos → 1 SELECT cada, 0 Google)

## Decisões
- Migration só schema: a correção de dado (contenção de 22.334 linhas) foi operação explícita em prod; se houver duplicata ativa, o `CREATE UNIQUE INDEX` falha alto em vez de "consertar" escondido.
- Erro do RPC com `code` (Postgres respondeu, rollback): para o canal novo no Google. Sem `code` (transporte/timeout): só loga — o commit pode ter ocorrido e parar o canal ativo deixaria a agenda muda; órfão expira sozinho e custa 1 SELECT por notificação.
- Sem `expiration` no banco, não renova: renovar às cegas é o que alimentou a multiplicação.

## Follow-ups
- Renovação por cron (hoje só renova se chegar notificação na janela de 2 dias; agenda parada deixa o canal expirar).
- Sincronização incremental com `syncToken` no lugar de `updatedMin` dos últimos 5 min.
- Corrida de refresh de token em `getValidAccessToken`.
- **Segurança (alta, PR próprio)**: state OAuth sem assinatura (`_shared/google-calendar-utils.ts` `decodeState`) — forjável, vetor cross-tenant no callback (userId/orgId vêm do state).
- Webhook não valida `X-Goog-Channel-Token` (registrar token no watch e conferir na notificação).
- Checar o CAS antes de chamar `events/watch` (hoje uma rajada de K paga K watches + K-1 stops no Google).
- `google-calendar-connect/index.ts:75` manda `orgId ?? ""` — o RPC rejeita (cast uuid); o canal novo agora é parado, mas a conexão fica sem watch.
- Ordem de deploy: migration ANTES das edge fns `google-calendar-webhook` e `google-calendar-callback`; o canal ativo restante entra na janela de renovação por volta de 2026-11-20/21.
