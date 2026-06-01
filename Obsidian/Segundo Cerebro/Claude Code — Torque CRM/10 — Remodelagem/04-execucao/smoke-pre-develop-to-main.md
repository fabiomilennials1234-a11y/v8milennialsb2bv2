---
type: how-to
title: Smoke checklist — pre PR develop → main (modularização)
status: active
created: 2026-05-28
tags: [remodelagem, smoke, deploy, modularizacao]
related: ["[[slices]]", "[[../../04 — Decisões/ADR-2026-05-28-modularizacao-conclusao]]"]
---

# Smoke checklist — pre PR `develop → main` (modularização)

Checklist manual a rodar **antes** do CTO abrir o PR `develop → main` da modularização. Cobre as 14 superfícies funcionais que tocam módulos reorganizados + a sequência de deploy crítica do event-bus piloto.

> **Branch alvo:** `develop` (com slices 0-19 mergeadas).
> **Quem roda:** CTO ou dev junior em ambiente **dev** (`bcfadphgsibjzivtbjvc`).
> **Saída:** Go / No-go pro PR.

## ⚠️ Sequência de deploy crítica (event-bus piloto)

Slice 19 adicionou a tabela `domain_events` + publicações em call sites. **Se o frontend for deployado antes da migration**, call sites tentarão inserir em tabela inexistente e quebrarão silenciosamente.

**Ordem obrigatória ao promover pra prod:**

1. **Aplicar migration `domain_events` em prod** (Supabase Management API ou `db push`).
2. **Deploy edge function `event-dispatcher`** em prod.
3. **Ativar cron de `event-dispatcher`** em prod (job pg_cron com `x-cron-secret`).
4. **Deploy frontend** (push Docker image + UI EasyPanel).

> Cron jobs existentes (workflow-executor, outbound-dispatch, …) continuam apontando pros paths atuais — edge functions ficaram flat. Nada a alterar lá.

## Pré-flight

- [ ] `git log origin/develop --oneline | head -25` mostra slices 16, 17, 18, 19 mergeadas.
- [ ] `npm ci` limpo em workspace dev.
- [ ] `npm run lint` verde (ESLint `boundaries` em error mode — qualquer violação para o pipeline).
- [ ] `npm run build` verde.
- [ ] `npm run test:unit` verde.
- [ ] `npm run test:integration` verde.
- [ ] `npm run test:e2e` verde (Playwright).
- [ ] Bundle size delta ±5% vs main (registrar valores).

## Superfícies funcionais (smoke manual em dev)

Login com 3 perfis: **admin org**, **membro** (com role custom restrita), **master**. Para cada superfície, anotar **OK / regressão / N/A**.

### 1. Autenticação + onboarding
- [ ] Login email/senha.
- [ ] Recover password.
- [ ] Master switch entre orgs.
- [ ] Onboarding tour novo usuário renderiza.

### 2. Leads
- [ ] Lista de leads carrega (filtros + saved views).
- [ ] Criar lead manual.
- [ ] Importação CSV / batch (`useImportBatches`).
- [ ] Bulk actions: assign, tag, mover de pipe.
- [ ] Modal de detalhe abre (timeline unificada — slice 4).
- [ ] Tags add/remove.

### 3. Pipelines (kanban)
- [ ] Pipe whatsapp / confirmacao / propostas renderizam.
- [ ] Drag stage → publica `lead.stage_changed` em `domain_events` (validar tabela em dev).
- [ ] Custom pipes carregam.
- [ ] Loss reasons aparecem no perdido.

### 4. Chat / comunicação
- [ ] Lista de conversas WhatsApp.
- [ ] Envio mensagem outbound (Uazapi).
- [ ] Recebimento inbound (webhook).
- [ ] Chat Meta (canal separado).
- [ ] Templates de mensagem.
- [ ] Mass send: criar + status + control.
- [ ] History sync.

### 5. Copilot (agentes IA)
- [ ] Listar agents.
- [ ] Criar agent (qualificador, sdr, followup, agendador, prospectador, custom).
- [ ] Configurar business context + capabilities.
- [ ] Ativar agent → conversa real-time.
- [ ] Edge cases: agent sem business_context, lead sem telefone.
- [ ] Oráculo Comercial (slice 16 — `copilot`) carrega.

### 6. Workflows
- [ ] DAG editor abre.
- [ ] Nodes: trigger, action, condition, delay, wait_response, split_ab, copilot, webhook_call, wait_business_window.
- [ ] Salvar workflow + ativar.
- [ ] Trigger sintético: lead_created executa.
- [ ] `workflow_executions` registra steps.

### 7. Campanhas
- [ ] Listar campanhas.
- [ ] Criar campanha + meta + round-robin + sequence msgs.
- [ ] Vincular agente IA.
- [ ] Stages da campanha.

### 8. Carteira / propostas / upsell
- [ ] Lista de propostas.
- [ ] Criar proposta.
- [ ] Upsell flow (`useUpsellImportLogic`).
- [ ] Deals fechados / perdidos.

### 9. Agenda + engagement
- [ ] Agenda renderiza (Google Calendar sync — `useGoogleCalendar`).
- [ ] Activities + checklist.
- [ ] Gamification (rankings, badges).
- [ ] Goals + commissions.
- [ ] Coaching sidebar + Next Best Actions panel (slice 16 — `engagement`).

### 10. Analytics / dashboard / TV
- [ ] Dashboard principal.
- [ ] TV dashboard rotation.
- [ ] Performance por vendedor.

### 11. Billing + marketing
- [ ] Subscription plan info.
- [ ] Landing leadforms.
- [ ] UTM tracking.

### 12. Platform (settings / observability / feature flags)
- [ ] Settings org.
- [ ] Permission tab (sem regression — `feedback_permission_tab_storage_split`).
- [ ] Feature flags toggle.
- [ ] Saved views / global shortcuts / sandbox (slice 16 — `platform`).

### 13. Identity (team)
- [ ] Listar team members.
- [ ] Avatares (`useAvatarMap`).
- [ ] Auto admin assignment (`useAutoAdminAssignment`).
- [ ] Master virtual id NÃO escreve em FKs (regression `feedback`/fix #511).

### 14. Integrations
- [ ] TinyERP sync.
- [ ] Asaas billing.
- [ ] n8n triggers.
- [ ] SZ.Chat / ElevenLabs.

## Pontos críticos a inspecionar

- [ ] Sentry sem novos erros nas últimas 24h em dev após smoke.
- [ ] Logs edge functions sem 500s novos.
- [ ] RLS funcionando: membro NÃO enxerga leads de outra org.
- [ ] Realtime updates chegam em kanban + chat.
- [ ] ESLint `boundaries` zero violations em `develop` HEAD.

## Após smoke OK

- [ ] CTO abre PR `develop → main` manualmente.
- [ ] CTO aplica migration `domain_events` em prod (passo 1 da sequência).
- [ ] CTO deploya `event-dispatcher` + ativa cron em prod (passos 2-3).
- [ ] CTO promove frontend (passo 4).
- [ ] Monitorar Sentry + logs nas primeiras 24h.

## Refs

- ADR conclusão: [[../../04 — Decisões/ADR-2026-05-28-modularizacao-conclusao]]
- ADR original: [[../../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular]]
- Slices: [[slices]]
- SPEC: `/.specs/features/modularizacao/SPEC.md`
