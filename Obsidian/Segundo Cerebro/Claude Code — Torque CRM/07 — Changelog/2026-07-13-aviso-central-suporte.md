---
type: changelog
title: Aviso in-app da Central de Suporte (modal + coach-mark)
status: done
created: 2026-07-13
updated: 2026-07-13
tags: [suporte, announcement, frontend]
related: ["[[Anuncio de Lancamento]]"]
owner: claude-agent
---

# 2026-07-13 — Aviso in-app da Central de Suporte

## Mudanças

- **Suporte**: anúncio de lançamento da Central de Suporte — modal de entrada (A) + coach-mark apontando o FAB "?" (C). Máx. 1×/sessão, máx. 2 sessões, morre pra sempre ao engajar (CTA ou abrir o suporte por qualquer via). Regras completas na nota [[Anuncio de Lancamento]].

## Arquivos tocados

- `src/modules/platform/lib/support-announcement.ts` — novo; state machine pura + persistência defensiva (localStorage por usuário + sessionStorage por sessão).
- `src/modules/platform/lib/support-announcement.test.ts` — novo; 19 testes de gating, parse defensivo e storage bloqueado.
- `src/modules/platform/components/support/SupportAnnouncement.tsx` — novo; modal A (Radix Dialog) + coach-mark C (portal, spotlight com furo clicável, anel pulsante `motion-safe`).
- `src/modules/platform/components/support/SupportFab.tsx` — atributo `data-support-fab` no botão (âncora do coach-mark).
- `src/App.tsx` — monta `<SupportAnnouncement />` após `<SupportPanel />` dentro do `SupportPanelProvider`.

## Decisões

- Aviso de resposta no 3º bullet do modal referencia o "? dourado" (badge do FAB via `useSupportUnread`) — o sininho de alertas não cobre suporte.
- Balão do coach-mark alinhado à base do FAB (não centro-verticalmente): o FAB vive colado no rodapé e centralizar furaria a viewport.
- Spotlight inteiro `pointer-events-none`: o FAB fica clicável através do furo, e clicar nele engaja (regra 7).

## Follow-ups

- Nenhum. Sem backend, sem migration, sem barrel export (deep-import intencional no App.tsx, padrão dos irmãos SupportPanel/SupportPanelProvider).
