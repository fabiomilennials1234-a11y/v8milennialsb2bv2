---
type: changelog
title: LPs no padrão V5 e rotas antigas aposentadas
status: active
created: 2026-11-04
updated: 2026-11-04
tags: [changelog, landing-page]
related: []
owner: claude-agent
---

# 2026-11-04 — LPs no padrão V5 e rotas antigas aposentadas

## Mudanças
- **LPs**: `/lp/gestao-comercial/` e `/lp/crm-b2b/` refeitas como HTML estático no sistema visual V5, sem gsap, three, motion ou tailwind. CSS e JS em `public/lp/_shared/`.
- **Demo**: as janelas de produto viraram a demo interativa de 6 telas, em JS puro (`public/lp/_shared/demo.js`).
- **Agendar**: todo CTA abre modal com o embed inline do Cal.com, só na agenda do Gabriel. Rodízio e formulário de qualificação saíram. Em `bookingSuccessful` a página envia `reuniao_marcada` ao webhook `torque-lp-lead`, com as respostas do evento (`telefone` vira `whatsapp`).
- **Tirar dúvidas**: modal com Nome, Empresa, WhatsApp (10 ou 11 dígitos) e E-mail. Envia `evento:"duvida"`, espera no máximo 1,5 s e abre o WhatsApp mesmo se o webhook falhar.
- **Meta Pixel**: `1588170885997511` nas duas LPs (`public/lp/_shared/pixel.js`). PageView, e Lead ou Schedule com o mesmo `event_id` do webhook, para a Meta deduplicar. CSP de LP ganhou `connect.facebook.net` e `www.facebook.com` e perdeu `cdn.jsdelivr.net` e `cdn.tailwindcss.com`.
- **Privacidade**: `public/privacidade.html`, seções 6 e 9, descreve o pixel e a API de Conversões.
- **Consentimento**: aviso com link para `/privacidade` nos dois modais.
- **Rotas**: `/lp/v1` vai para `/lp/gestao-comercial/`; `/lp/v2`, `/lp/v3` e `/lp/demonstracao` vão para `/lp/crm-b2b/`, com 301 e query preservada, no Worker e no nginx. Subcaminho vai para o mesmo destino.
- **SEO**: LP `gestao-comercial` indexável com canonical própria; `crm-b2b` noindex. Sitemap, `index.html`, `llms.txt` e `llms-full.txt` apontam para a nova URL.

## Arquivos tocados
- `public/lp/_shared/lp.js`, `public/lp/_shared/demo.js`, `public/lp/_shared/torque-lp-v5.css` — modais, envio, demo e sistema visual
- `public/lp/gestao-comercial/index.html`, `public/lp/crm-b2b/index.html` — páginas
- `cloudflare/src/routing.ts`, `cloudflare/src/worker.ts` — `RETIRED_LANDINGS` e rota `landing-redirect`
- `Dockerfile` — `map $lp_retired` e `absolute_redirect off` no bloco `/lp/`
- `scripts/cloudflare/parity.mjs`, `tests/unit/cloudflare/*` — casos das rotas novas e aposentadas

## Decisões
- Modais com `<dialog>` nativo, fora de `.lp`: o `container-type` de `.lp` prenderia `position: fixed`.
- Embed do Cal.com criado só na primeira abertura do modal.
- `bookingSuccessfulV2` é só reserva: entra se o evento antigo não vier, sem respostas do participante.

## Follow-ups
- Aplicar o patch do n8n antes do deploy: tag `LP lp`, vazio no PATCH e `notes` só em lead novo.
- Conferir `booking.responses` em uma reserva real.
