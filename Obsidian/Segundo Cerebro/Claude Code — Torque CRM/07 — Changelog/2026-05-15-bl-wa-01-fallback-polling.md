---
type: changelog
title: BL-WA-01 — Fallback polling realtime
status: shipped
created: 2026-05-15
updated: 2026-05-15
tags: [uncategorized]
related: []
owner: gabriel
---

# BL-WA-01 — Fallback polling realtime

Fecha o gap UX onde o frontend ficava silencioso por minutos quando o canal Supabase Realtime não conseguia rejoin (Wi-Fi flaky, proxy corporativo, server hiccup). Agora, após 2 min sem `joined`, `useWhatsAppMessages` e `useWhatsAppContacts` ativam `refetchInterval: 10s` automaticamente. Quando o canal volta a `joined`, o polling para sozinho.

## Componentes

- `src/hooks/chat/useRealtimeFallback.ts` — novo. Expõe `useWhatsAppRealtimeFallback(orgId)` (`{ shouldPoll }`) + função pura `shouldFallback(state, lastTransitionAt, now)` testável.
- `src/hooks/chat/useWhatsAppMessages.ts` — consome fallback, seta `refetchInterval: shouldPoll ? 10_000 : false`.
- `src/hooks/chat/useWhatsAppContacts.ts` — idem.
- `tests/unit/useRealtimeFallback.test.ts` — 5 testes da função pura cobrindo grace window, threshold exato, recovery após rejoin, custom threshold.

## Constantes

- `FALLBACK_THRESHOLD_MS = 120_000` (2 min de grace antes de virar polling)
- `FALLBACK_POLL_INTERVAL_MS = 10_000` (refetch a cada 10s enquanto canal off)
- Ticker interno do hook: 15s (re-avalia decisão sem depender de transição de estado)

## Comportamento

| Estado canal | Tempo desde transição | shouldPoll |
|---|---|---|
| `joined` | qualquer | false |
| `offline`/`stale`/`reconnecting`/`joining`/`unknown` | < 2 min | false (heartbeat já tenta reconnect) |
| `offline`/`stale`/`reconnecting`/`joining`/`unknown` | ≥ 2 min | **true** (10s polling) |

`recordChannelEvent` (chamado pelo hook realtime ao receber payload) também conta como "vivo" via `lastEventAt`, mas a decisão usa `lastTransitionAt` pra evitar flapping enquanto o estado oscila entre stale↔reconnecting.

## Critério de aceite

- [x] Forçar `supabase.removeChannel()` via DevTools → após 2 min mensagens novas aparecem em ≤15s via polling
- [x] Status badge mostra "Sincronizando" durante fallback (já coberto pelo badge existente: `stale`/`reconnecting` → variant pending)
- [x] Quando channel rejoin, polling para automaticamente (state vira `joined`, `shouldPoll` vira false no próximo tick)

## Verificação

```bash
npx vitest run tests/unit/useRealtimeFallback.test.ts
```

Todos os 5 testes passam. Regressão Uazapi V2 (14 testes em `uazapi-payload-resolution.test.ts`) continua verde.

## Notas

- Não há mudança de banco / edge function / migration. Frontend-only.
- Não há prod write — deploy via push em main → Docker → EasyPanel cobre.
- Próximo item da ordem: BL-WA-02 pulado (decisão CTO 2026-05-15 — sem notificação dono nessa rodada). Pular pra BL-WA-03 (banner sessão morta) ou BL-WA-04 (mídia DLQ).
