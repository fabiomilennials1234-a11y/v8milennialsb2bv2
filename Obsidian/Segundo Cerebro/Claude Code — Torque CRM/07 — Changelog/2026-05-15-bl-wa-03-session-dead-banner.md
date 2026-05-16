---
type: changelog
title: BL-WA-03 — UI banner sessão morta
status: shipped
created: 2026-05-15
updated: 2026-05-15
tags: [uncategorized]
related: []
owner: gabriel
---

# BL-WA-03 — UI banner sessão morta

Banner persistente em todas as páginas autenticadas enquanto a org tem instância WhatsApp com `session_dead_since IS NOT NULL`. Antes, o `whatsapp-session-watchdog` (cron 10min) registrava no DB mas usuário descobria silêncio só pelas mensagens não chegando.

Decisão de escopo: montar no `MainLayout` em vez de só `WhatsAppChat`/`ChatShellWithContext` (como o backlog sugeria). Motivo: gestor que está em `/funis`, `/dashboard`, ou kanban precisa ver a falha imediatamente — não só se entrar no chat. Steady-state = banner retorna `null`, custo zero de layout.

## Componentes

- `src/hooks/useDeadSessions.ts` — novo. Query `whatsapp_instances` filtrando `session_dead_since IS NOT NULL`. Polling 30s + staleTime 15s.
- `src/components/whatsapp/SessionDeadBanner.tsx` — novo. Self-hides quando lista vazia. Mostra single-instance label (nome + telefone formatado) ou agregado (`N números desconectados`). CTA "Reparear agora" → `/settings`.
- `src/components/layout/MainLayout.tsx` — monta `<SessionDeadBanner />` logo abaixo de `<TopNavigation />`.
- `tests/unit/SessionDeadBanner.test.tsx` — 4 testes: empty, loading, single, multi.

## Comportamento

| Estado | Render |
|---|---|
| `data === undefined` (loading) | null |
| `data.length === 0` | null |
| 1 sessão morta | `<instance_name> (<telefone>) está desconectado` + CTA |
| 2+ sessões | `N números do WhatsApp estão desconectados` + CTA |

CTA navega pra `/settings` onde o fluxo de QR re-pair existente vive (`useRefreshQRCode` em `WhatsAppSettings`). Não foi criada modal nova nessa rodada — keep simples; melhoria futura: deep-link com `?focus_instance=<id>` pra rolar/destacar.

## Critério de aceite

- [x] Sessão dead → banner vermelho topo página em <30s (polling 30s + staleTime 15s ≈ ≤30s end-to-end)
- [x] Click "Reparear" → vai pra /settings (QR refresh disponível ali)
- [x] Recovery (watchdog limpa `session_dead_since`) → banner some no próximo poll

## Verificação

```bash
npx vitest run tests/unit/SessionDeadBanner.test.tsx
```

4/4 passam. ESLint clean.

## Notas

- Frontend-only. Sem migration. Sem edge function. Sem prod write.
- Não depende de BL-WA-02 (notificação ativa) — banner consome diretamente o estado já mantido pelo watchdog.
- Próximo: BL-WA-04 (Mídia DLQ + retry, 3h) ou BL-WA-07/09/10/11/12/13 conforme prioridade do CTO.
