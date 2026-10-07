---
type: changelog
title: Front estático na Cloudflare Workers — fase de teste no workers.dev
status: in-progress
created: 2026-10-06
updated: 2026-10-06
tags: [changelog, infra, cloudflare, deploy, front]
related: []
owner: claude-agent
---

# 2026-10-06 — Front estático na Cloudflare Workers (fase `workers.dev`)

## Por quê
A queda de 06/10 foi OOM na VPS. O front é estático: não precisa de servidor nem de memória da VPS. Esta fase prova que a Cloudflare entrega **byte a byte** o que o nginx entrega hoje, numa URL `*.workers.dev`, sem tocar DNS nem produção.

## O que entrou
- **`cloudflare/`** — Worker `torque-front` + Static Assets. Pacote isolado (wrangler 4.147.0 exige Node 22; a imagem do `Dockerfile` usa Node 20 e não o vê). `wrangler.jsonc` sem `account_id`, sem `routes`, sem segredo.
- **`cloudflare/src/routing.ts`** — precedência do nginx (`Dockerfile:117-180`) como função pura: cookie `torque_ui` escolhe V5 ou clássica, `/lp/*`, páginas fixas, `/api/v1/*`, fallback do SPA.
- **`cloudflare/headers.json`** — fonte única dos headers, espelho do `Dockerfile`; o teste `headers-drift` quebra se divergirem.
- **`cloudflare/src/api-proxy.ts`** — `/api/v1/*` → edge function `api`; repassa `X-API-Key` sem tocar, 1 MiB / 30 s, recusa `..` disfarçado.
- **`scripts/cloudflare/`** — `cf:extract` (baixa o front no ar, só leitura), `cf:prepare` (remove source map, recusa segredo, gera `_headers` e `.assetsignore`), `cf:parity` (A × B, URL por URL).
- **Logs** — negar por padrão: rotas de estrutura conhecida gravam o caminho com token mascarado; o resto grava só o 1º segmento (`:seg` se não parece rota). `invocation_logs: false`, `redact_query_string: true`.
- **`package.json`** — só scripts `cf:*`. `.gitignore` e `eslint.config.js` ignoram o que é gerado (`.prod-dist`, `.assets`, `.wrangler`, `.dev.vars*`).
- **Operação**: `docs/DEPLOY_CLOUDFLARE.md` (passo a passo, Div1–Div12, checklist do corte).

## Evidência
- Paridade: 597 casos, FAIL 0; `all-assets` 472/472.
- 232 testes em `tests/unit/cloudflare/`; controle positivo: caminho inteiro no 405 → 17 testes quebram.
- Revisor APROVA com rubric de segurança; QA PASSA com navegador e ataque (35 variantes de token no caminho → 0 linhas de log com o token).

## Produção
Sem mudança. O EasyPanel builda a `main`; `cloudflare/` não entra na imagem e `src/` não foi tocado.

## Pendente
- Login do CTO → `cf:deploy` no `workers.dev` → smoke g–k.
- Fase de corte de DNS: checklist a–o do doc + ADR (decide o item j, logs da plataforma).
- Bugs de produção achados, em tarefas separadas: redirect para `:8080` (Div4); fonte da V5 quebrada com service worker desde o #2246 (urgente); limpeza de URL do Sentry sem `/checkout` e sensível a maiúscula.
