# Análise de Gap — API Torque CRM vs Kommo / RD Station / Clint

**Data:** 2026-06-14 · **Base comparada:** docs oficiais (developers.kommo.com, developers.rdstation.com, clint-api.readme.io) vs nossa `src/lib/api-docs/endpoints.ts`.

## TL;DR

A percepção de "nossa API tem pouca coisa" está **meia-certa**. A doc pública expõe pouco (8 endpoints, quase só ingestão de lead). Mas parte do que falta **já existe no backend e não está documentado** — principalmente webhooks de saída com HMAC. O gap real divide-se em dois baldes:

- **Documentar o que já temos** (barato, dias): webhooks de saída, formato de erro, rate limits, OpenAPI/Postman, llms.txt.
- **Construir o que não temos** (real, semanas): API de LEITURA/CRUD sobre leads/deals/pipelines. Esse é o gap estrutural — os 3 concorrentes deixam o integrador **ler e alterar** o CRM; nós só deixamos **alimentar**.

## O que nossa API é hoje

Ingestão-first. 8 endpoints:
- **Entrada de lead** (4): `partner-webhook`, `lead-webhook`, `webhook-orchestrator` (multi-ação), + 2 legados.
- **Bulk** (1): `import-leads` (≤1000).
- **Leitura** (1): `get-lead-timeline`.
- **Infra** (1): `check-api-health`.

Auth: API Key estática (`tq_live_*` / `X-Webhook-Key`) + JWT em 2 reads. Sem OAuth, sem GET de coleções, sem CRUD de recursos, sem doc de eventos de saída.

## Matriz de capacidades

| Capacidade | Torque (hoje) | Kommo | RD Station | Clint |
|---|---|---|---|---|
| Ingestão de lead (webhook entrada) | ✅ forte (campos custom auto, place_in_pipe/campaign) | ✅ | ✅ (conversão) | ✅ |
| Bulk import | ✅ (1000) | ✅ (250) | ⚠️ via eventos | ❌ |
| **GET list/single de leads/deals** | ❌ | ✅ filtros+paginação | ✅ v1/v2 RDQL | ✅ |
| **CRUD deals/contacts/orgs** | ❌ (só ações via orchestrator) | ✅ (sem DELETE) | ✅ (sem DELETE) | ✅ (CRUD pleno) |
| **CRUD pipelines/stages** | ❌ | ✅ | ✅ | ⚠️ |
| Tasks / Notes / Activities | ❌ | ✅ | ✅ | ❌ (activities não na API) |
| Custom fields via API | ⚠️ (auto-cria no ingest) | ✅ CRUD | ✅ CRUD | ✅ |
| **Webhooks de SAÍDA (eventos)** | 🟡 **existe, não documentado** | ✅ (sem HMAC) | ✅ | ✅ |
| Assinatura HMAC no outbound | ✅ **(X-Webhook-Signature-256)** | ❌ | ⚠️ | ⚠️ |
| OAuth2 | ❌ | ✅ | ✅ (CRM v2 + Mktg) | ❌ |
| Rate limits documentados | ⚠️ (só 1 endpoint) | ✅ 7req/s | ✅ tabela | ❌ |
| Formato de erro padronizado | ❌ não documentado | ✅ RFC-like | ⚠️ | ❌ |
| OpenAPI / Postman | ❌ | 🟡 por endpoint | ✅ Postman+Insomnia | 🟡 ReadMe |
| llms.txt (índice p/ IA) | ❌ | ✅ | ✅ | ❌ |
| Events/Conversão API | 🟡 (meeting_events interno) | ✅ | ✅ (núcleo) | ⚠️ |

## O que JÁ temos e não documentamos (quick wins)

1. **Webhooks de saída com HMAC.** Tabela `webhooks` + `webhook_deliveries` + `process-webhook-deliveries` + dead-letter (`webhook_dead_letters`). Assinatura **HMAC-SHA256** (`X-Webhook-Signature-256`), validação anti-SSRF de URL, retry. Triggers já cobrem leads, pipes, follow-ups, campanhas (migrations `20260211*`/`20260212*`). **Kommo não tem HMAC — isso é vantagem nossa, escondida.** Falta: documentar eventos disponíveis + como assinar/registrar.
2. **Rate limit** já implementado (60/min no partner-webhook) — só documentar globalmente.
3. **webhook-orchestrator** já faz `UPDATE_LEAD`, `SCHEDULE_MEETING`, `TRANSFER_HUMAN` — é CRUD parcial disfarçado de ação; documentar melhor.

## Gaps reais (construir), por prioridade

### P0 — Documentar o existente (esforço: baixo, ~3-5 dias)
- Adicionar categoria **"Webhooks de Saída"** na doc: lista de eventos (`lead.created`, `lead.stage_changed`, `deal.won`, etc.), payload, header de assinatura, verificação HMAC, registro.
- Documentar **formato de erro padrão** + tabela de HTTP codes (400/401/429/500) — hoje não existe.
- Documentar **rate limits** e **paginação/filtros** como convenção global.
- Gerar **OpenAPI 3 spec + Postman collection** a partir do `endpoints.ts` (já é estruturado — dá pra derivar). Publicar **llms.txt** (on-brand: somos AI-first; Kommo e RD já têm).

### P1 — API de Leitura (esforço: médio, ~1-2 semanas)
O gap mais sentido por qualquer integrador. Hoje não dá pra **ler** o CRM via API.
- `GET /leads` (list com filtros: stage, tag, origin, período, responsável + paginação cursor) e `GET /leads/{id}`.
- `GET /pipelines`, `GET /pipelines/{id}/stages`.
- `GET /deals` (Orçamentos) com filtros.
- Reaproveitar RLS + RPCs já existentes; expor via edge function com API Key escopada.

### P2 — CRUD sobre recursos (esforço: alto, ~3-4 semanas)
- `PATCH /leads/{id}` (atualizar campos, tags, responsável).
- `POST /leads/{id}/stage` (mover de etapa — hoje só interno).
- CRUD de tasks/follow-ups, notes/timeline (escrita), custom fields.
- Decisão de design: REST por recurso (como Kommo/RD/Clint) vs manter ações no orchestrator. Recomendo **REST por recurso** — é o que integrador espera e o que ferramenta (Zapier/n8n/Make) consome melhor.

### P3 — OAuth2 + marketplace (esforço: alto, só se for estratégia)
- Necessário se quisermos **apps de terceiros instalando** no Torque (modelo Kommo marketplace). Para integração 1:1 com parceiro, API Key basta. **Adiar** até haver demanda de ecossistema.

## Recomendação estratégica

A pergunta de fundo não é "temos pouca coisa?" e sim **"queremos que integrem PRA DENTRO do Torque, ou só ALIMENTEM o Torque?"**

- Kommo/RD/Clint expõem CRUD porque o integrador **constrói sobre** eles (são plataformas).
- Nós somos **AI-CRM com automação interna** — boa parte do que o concorrente terceiriza via API, nós resolvemos com Copilot/workflows nativos (igual Clint, que aposta em automação nativa em vez de API rica).

**Plano sugerido:** fazer **P0 já** (transforma a doc de "pobre" em "completa e profissional" sem build pesado, e expõe a vantagem do HMAC), depois **P1** (leitura) que destrava 80% dos casos de sincronização. P2/P3 só com demanda concreta de parceiro.

Resultado de P0+P1: saímos de 8 endpoints "só ingestão" para uma API de **ingestão + leitura + eventos de saída assinados** — comparável ao núcleo de Kommo/RD para o caso B2B, sem o peso de CRUD completo que talvez nunca usemos.
