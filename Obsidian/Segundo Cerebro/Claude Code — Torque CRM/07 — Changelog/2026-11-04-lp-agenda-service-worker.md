---
type: changelog
title: Agenda das LPs presa em Carregando para quem já abriu o CRM
status: active
created: 2026-11-04
updated: 2026-11-04
tags: [changelog, landing-page, pwa]
related: []
owner: claude-agent
---

# 2026-11-04 — Agenda das LPs presa em "Carregando" para quem já abriu o CRM

## Mudanças
- **Service worker**: as rotas de script, estilo, fonte e imagem valem só para a própria origem e fora de `/lp/`. Antes, o `fetch` do SW obedecia à CSP do app e derrubava `embed.js` do Cal.com e `fbevents.js` da Meta.
- **Precache**: `lp/**` saiu do manifesto, para a LP não ficar defasada.
- **Agenda**: "Carregando agenda…" nunca fica para sempre. Erro do script, nenhum iframe em 8 s ou nenhuma resposta do Cal em 20 s mostram o botão "Abrir a agenda em nova aba". Reabrir o modal tenta de novo.
- **iPhone**: campo da demo com 16 px, altura com `dvh` e reserva em `vh`, e acesso direto em navegador sem `<dialog>`.

## Arquivos tocados
- `src/sw.ts`, `src/shared/pwa/runtime-routes.ts`, `vite.config.ts` — rotas e manifesto
- `public/lp/_shared/lp.js`, `public/lp/_shared/demo.js`, `public/lp/_shared/torque-lp-v5.css` — fallback da agenda e ajustes de Safari
- `tests/unit/sw-runtime-routes.test.ts` — trava a rota e o manifesto

## Decisões
- A LP não envia `SKIP_WAITING`: forçar a troca recarregaria abas abertas do CRM. Quem está com o SW antigo vê o botão até aceitar a atualização.

## Follow-ups
- Layout das LPs em iOS anterior ao 16, sem container queries.

## Contrato com o n8n
- O formulário de dúvidas envia com `sendBeacon` em `text/plain` e navega ao WhatsApp no mesmo tick, para o iOS abrir o app. Webhook real `torque-lp-lead` testado com esse formato (execução 113673). Reserva segue em JSON.
