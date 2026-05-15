---
tags:
  - resume-prompt
  - claude-handoff
  - chat
  - whatsapp
created: 2026-05-15
status: ready
---

# Prompt de retomada — WhatsApp stability (sessão nova do Claude)

Cole o bloco abaixo em uma nova sessão `claude` aberta dentro de `C:\Users\torch\Desktop\milennials\v8milennialsb2bv2`. O Claude já carrega `CLAUDE.md` automaticamente — o bloco completa o que CLAUDE.md não diz.

> [!info] Como usar
> 1. `cd C:\Users\torch\Desktop\milennials\v8milennialsb2bv2`
> 2. `claude` (abre Claude Code na pasta)
> 3. Cole o prompt completo abaixo
> 4. Confirme as 3 decisões pendentes quando ele perguntar
> 5. Autorize prod write quando ele pedir (se for executar items que escrevem em prod)

---

## ▼▼▼ COPIE TUDO ABAIXO ▼▼▼

```
Você está retomando o trabalho de estabilização do pipeline WhatsApp do TorqueCRM.
Sessão anterior fechou um incidente Uazapi V2 schema change e deployou 6 componentes
de hardening. Resta fechar gaps específicos pra chegar em ~99% funcional.

LEIA NESTA ORDEM antes de fazer qualquer coisa:

1. docs/INCIDENT_2026_05_14_UAZAPI_V2.md
   — Incidente completo: timeline, root cause, mitigação aplicada live.

2. docs/WHATSAPP_STABILITY_PLAN.md
   — Plano de 6 componentes com princípios, rollback per item.

3. Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/Chat/whatsapp-stability-plan.md
   — Estado consolidado: % funcional por dimensão, status de cada componente,
     gaps fora do plano original (mídia, grupos, outbound monitoring).

4. Obsidian/Segundo Cerebro/Claude Code — Torque CRM/08 — Backlog/em-progresso/whatsapp-stability-100pct.md
   — 14 itens BL-WA-01..14 com escopo, arquivos, critério aceite, esforço.

ESTADO ATUAL (verificar antes de agir, dados podem ter mudado):

  Branch: fix/whatsapp-rebind-webhook (origin existe, ainda não mergeada em main)
  4 commits empilhados:
    085d2a93 fix(whatsapp-webhook): tolerate Uazapi V2 payload schema variations
    1263b2e7 feat: add whatsapp-rebind-webhook
    3c7e2206 feat(whatsapp): stability plan components 1-3
    90e5ab7a feat(whatsapp): stability plan components 4-6

  Migrations aplicadas em prod (project ref jsjsmuncfkbsbzqzqhfq):
    20261012000000 whatsapp_webhook_dlq
    20261012000001 schedule_whatsapp_dlq_replay
    20261012000002 whatsapp_session_dead_since (+ session_dead_reason)
    20261012000003 schedule_whatsapp_session_watchdog
    20261012000004 whatsapp_health_checks
    20261012000005 schedule_whatsapp_health_monitor
    20261012000006 whatsapp_messages_received_via

  Edge functions deployed em prod:
    whatsapp-webhook (patched: defensive resolution + DLQ write + replay header)
    whatsapp-rebind-webhook (scoped rebind)
    whatsapp-dlq-replay (cron 5min)
    whatsapp-session-watchdog (cron 10min)
    whatsapp-health-monitor (cron 5min)
    history-sync-worker (tags received_via='history_sync')

  Cron jobs ativos:
    whatsapp_dlq_replay        */5 * * * *
    whatsapp_health_monitor    */5 * * * *
    whatsapp_session_watchdog  */10 * * * *

  Uazapi: servidor é https://milennialstech.uazapi.com (admin token + per-instance
  tokens guardados em prod Supabase env e em whatsapp_instance_secrets).
  39 instâncias V8-linked. 6 com sessão morta esperando re-pair humano (lista no
  doc de incidente).

  Backfill 13 jobs scope=incremental em history_sync_jobs (criados 2026-05-15).
  Worker pg_cron drena progressivamente. Verificar status atual com:
    SELECT i.instance_name, h.status, h.total_fetched, h.chats_completed,
           h.total_chats, h.error
    FROM history_sync_jobs h
    JOIN whatsapp_instances i ON i.id = h.instance_id
    WHERE h.scope = 'incremental'
      AND h.created_at > now() - interval '7 days'
    ORDER BY h.created_at DESC;

REGRAS NESSA SESSÃO:

  - Default = dev. Prod precisa autorização explícita por sessão (memória do CTO).
  - "Push sempre em branch nova" — não dar push direto em main/develop.
  - Patch defensivo + helpers em whatsapp-webhook são intocáveis sem teste regressivo.
  - Não mexer no padrão webhook canônico sem rodar testes Vitest:
        npx vitest run tests/unit/uazapi-payload-resolution.test.ts

  - Toda mudança que escrever em prod (migration apply, edge fn deploy, INSERT em
    massa) precisa autorização explícita por sessão. Memória registrou isso.
    Hook bloqueia tentativas sem auth.

DECISÕES PENDENTES (perguntar ao CTO ANTES de implementar):

  D1. PR fix/whatsapp-rebind-webhook → main: merge agora ou esperar mais validação?
      (Branch tem patch + 6 componentes + dashboard. Frontend só ativa após merge.)

  D2. BL-WA-05 (mensagens de grupo): capturar com is_group:true, ou manter dropados?
      Barulinho Bom tem grupo crítico ativo.

  D3. BL-WA-02 notificação dono sessão morta: push V8 apenas, ou push + email?
      Email exige SMTP configurado (Resend? SES? verificar env).

PRÓXIMA AÇÃO RECOMENDADA:

  Ordem do backlog (definida em 08 — Backlog/em-progresso/whatsapp-stability-100pct.md):

  Top 3 (4h, fecha gap UX + visibilidade):
    BL-WA-01 Fallback polling realtime
    BL-WA-02 Notificação dono sessão morta
    BL-WA-03 UI banner sessão morta

  Top 10 (12h, fecha quase tudo):
    + BL-WA-04 Mídia DLQ + retry
    + BL-WA-07 Botões rebind/replay no dashboard
    + BL-WA-09 Sentry tags estruturadas
    + BL-WA-10 Outbound monitoring
    + BL-WA-11 E2E test webhook → DB
    + BL-WA-12 Cleanup reconfigure-uazapi-webhooks legado
    + BL-WA-13 Refactor reconnect (remover dispatchEvent hack)

  Restante (~4h):
    BL-WA-05 Grupos (decisão produto bloqueia)
    BL-WA-06 Schema snapshot diário
    BL-WA-08 Gráfico drift histórico
    BL-WA-14 Test realtime reconnect

COMO COMEÇAR:

  1. Confirme leitura dos 4 docs acima
  2. Faça `git status` + `git log --oneline -10` pra ver estado real do branch
  3. Pergunte ao CTO sobre D1, D2, D3
  4. Pergunte qual item começar (sugestão: BL-WA-01)
  5. Pede autorização explícita pra prod write antes de qualquer mutation lá
  6. Atualize o checkbox em whatsapp-stability-100pct.md quando completar item
  7. Commit em fix/whatsapp-rebind-webhook (ou branch nova se PR já fechou)

OUTPUTS QUE O CTO ESPERA NO FINAL DE CADA ITEM:

  - Diff resumido + arquivos tocados
  - Migration nome + se foi aplicada em dev/prod
  - Edge function deployed sim/não
  - Teste rodado: comando + resultado
  - Checkbox marcado em whatsapp-stability-100pct.md
  - Commit message com BL-WA-XX no início

NÃO IMPLEMENTE ITEM NOVO SEM TERMINAR O ANTERIOR. Profundidade > paralelismo.

Se for ler memory: a memória global tem 3 entries críticas:
  - feedback_dev_only.md (default dev, prod só com pedido explícito)
  - feedback_never_deploy_prod.md (idem)
  - feedback_push_new_branch.md (push em branch nova)
```

## ▲▲▲ COPIE TUDO ACIMA ▲▲▲

---

## Checklist pra mim (CTO) antes de abrir nova sessão

- [ ] `fix/whatsapp-rebind-webhook` ainda existe em origin? `git ls-remote origin fix/whatsapp-rebind-webhook`
- [ ] Decisões D1/D2/D3 com resposta clara em mente (não precisa decidir agora — Claude vai perguntar)
- [ ] Tempo bloqueado: 1h pra primeiros 3 itens (BL-WA-01..03)
- [ ] Tabs abertas: Supabase Dashboard prod + Sentry (pra ver auto-rebind events que dispararem na sessão)

## Pontos de verificação durante nova sessão

| Verificação | Comando |
|---|---|
| Cron jobs ativos | SQL: `SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'whatsapp_%'` |
| Sessões mortas | `/master/whatsapp-health` aba "Sessões mortas" |
| DLQ stats | SQL: `SELECT reason, count(*), max(received_at) FROM whatsapp_webhook_dlq WHERE resolved_at IS NULL GROUP BY reason` |
| Health checks recentes | SQL: `SELECT status, count(*) FROM whatsapp_health_checks WHERE checked_at > now()-interval '1 hour' GROUP BY status` |
| Backfill restante | SQL: `SELECT status, count(*) FROM history_sync_jobs WHERE triggered_by='incremental' GROUP BY status` |
| Tests passing | `npx vitest run tests/unit/uazapi-payload-resolution.test.ts` |
| Branch ativo | `git status && git log --oneline -5` |

## Pra retomar trabalho meses depois

Caso passe muito tempo, antes de continuar:

1. `git pull origin fix/whatsapp-rebind-webhook` (ou main se mergeou)
2. Rodar testes: `npm run test:unit` (deve passar 14 testes Uazapi V2)
3. Verificar Sentry: `whatsapp_*` issues abertas? Ler causa antes de mudar código
4. `/master/whatsapp-health`: drift atual? Sessões mortas acumuladas?
5. Ler doc principal `06 — Features/Chat/whatsapp-stability-plan.md` (pode ter mudado)
6. Ler backlog `whatsapp-stability-100pct.md` (checkboxes mostram progresso real)

Se Uazapi mudou schema de novo (probable em meses), os testes Vitest devem pegar
OU `whatsapp_resolved_by_token_fallback` deve subir em volume. Ambos sinais.
