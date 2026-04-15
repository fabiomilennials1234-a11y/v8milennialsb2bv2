---
tags:
  - claude-code
  - operacional
  - torque-crm
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Fluxos de Trabalho

## Resumo

Como executar as tarefas mais comuns no Torque CRM: desde desenvolver features ate provisionar clientes e debugar problemas em producao.

## Lifecycle de um lead

```
Entrada (n8n/webhook/manual)
  → pipe_whatsapp: novo → abordado → respondeu → agendado
    → pipe_confirmacao: reuniao_marcada → confirmar_d5 → d3 → d1 → compareceu
      → pipe_propostas: proposta_enviada → vendido/perdido
        → upsell (pos-venda)
```

- Um lead pode estar em MULTIPLOS pipes simultaneamente
- Stages finais: `vendido` (positivo) ou `perdido` (negativo)
- Um lead tem 3 responsaveis possiveis: responsible, sdr, closer (FKs para `team_members`)

## Fluxo n8n → V8 (padrao de ingestao)

1. Lead entra no Trello (Meta Ads → Make/Zapier → Trello card)
2. n8n monitora o board Trello (`Trello Trigger`)
3. n8n extrai dados do card (nome, telefone, empresa, faturamento via regex no `desc`)
4. n8n classifica por faturamento → tag (Latao/Prata/Ouro/Diamante)
5. n8n envia POST para `lead-webhook` com campos + tags + pipe placement

> 20+ workflows n8n seguem esse padrao, um por cliente, cada um com seu board Trello e `assigned_user_id`.

## Fluxo de desenvolvimento

### Adicionar feature frontend

1. Criar/editar componentes em `src/components/<modulo>/`
2. Criar/editar hooks em `src/hooks/use<Feature>.ts`
3. Usar React Query (queryKey, queryFn, enabled)
4. Invalidar queries corretas no mutation (onSuccess)
5. Rodar `npm run test:unit`
6. Testar no browser (`npm run dev` → localhost:8080)

### Adicionar edge function

1. Criar pasta `supabase/functions/<nome>/index.ts`
2. Usar padrao: `Deno.serve(withSentry('nome', ...))` + CORS
3. Se nao precisa JWT: adicionar `verify_jwt = false` em `supabase/config.toml`
4. Deploy: `supabase functions deploy <nome> --project-ref <ref>`
5. Se for cron: criar trigger pg_cron via migration SQL

### Adicionar migration

1. Criar arquivo em `supabase/migrations/YYYYMMDDHHMMSS_<descricao>.sql`
2. Nunca editar migration existente - sempre criar nova
3. Testar local: `supabase db push`
4. Deploy: migration roda automaticamente ao fazer push no Supabase

## Provisionar cliente novo

1. Criar org (via Supabase Dashboard ou `checkout-provision-org`)
2. Criar usuario admin (`create-org-user` edge function)
3. Vincular usuario a org (`assign-user-to-org`)
4. Configurar plano e limites
5. Configurar instancia WhatsApp (se aplicavel)

## Resetar dados de teste

Deletar em ordem (FK constraints):
```sql
DELETE FROM lead_tags WHERE organization_id = '<org_id>';
DELETE FROM pipe_whatsapp WHERE organization_id = '<org_id>';
DELETE FROM pipe_confirmacao WHERE organization_id = '<org_id>';
DELETE FROM pipe_propostas WHERE organization_id = '<org_id>';
DELETE FROM leads WHERE organization_id = '<org_id>';
DELETE FROM conversations WHERE organization_id = '<org_id>';
```

## Debugging em producao

### Logs de edge function

```bash
supabase functions logs <nome> --project-ref jsjsmuncfkbsbzqzqhfq
```

Logs tambem salvos na tabela `runtime_logs` via `_shared/logger.ts`.

### Testar edge function local

```bash
supabase functions serve <nome> --env-file .env.local
curl http://localhost:54321/functions/v1/<nome>
```

### Consultar banco de producao

```bash
curl "https://jsjsmuncfkbsbzqzqhfq.supabase.co/rest/v1/<tabela>?select=*&limit=5" \
  -H "apikey: SERVICE_KEY" -H "Authorization: Bearer SERVICE_KEY"
```

## Cron jobs (pg_cron)

17 jobs configurados. Os mais criticos:

| Job | Frequencia | Edge Function |
|-----|-----------|---------------|
| `process-webhook-deliveries` | 1 min | Batch 100 webhooks |
| `process-workflow-executions` | 1 min | Batch 20 workflows |
| `process-ai-actions` | 1 min | Acoes IA pendentes |
| `pipe-rule-dispatch` | 1 min | Regras de pipe |
| `campaign-rule-dispatch` | 1 min | Regras de campanha |
| `process-outbound-dispatches` | 5 min | Disparos outbound |
| `process-copilot-followups` | 5 min | Follow-ups do copilot |
| `retry-dead-letter-jobs` | 5 min | Retry de jobs falhos |
| `refresh-meta-tokens` | Diario 2AM | Renovar tokens Meta |
| `cleanup_runtime_logs_90d` | Diario 3AM | Limpar logs >90 dias |

Todos usam pg_net para chamar edge functions com header `x-cron-secret`.

## Realtime

```typescript
useRealtimeSubscription(table, queryKeys)
```

- Subscreve em `postgres_changes`
- Filtra por `organization_id`
- Debounce de 2s
- Usado em: chat, leads, pipes

## Links relacionados

- [[MOC - Operacional]]

- [[Visao Geral]]

- [[Analise Logging SaaS]]

- [[Checkout e Planos]]

- [[Regras de Pipe]]

- [[Gestao de Time]]

- [[Webhooks]]

- [[n8n Orquestracao]]

- [[Dashboard]]

- [[Upsell]]

- [[Meta Facebook]]

- [[Pipe Propostas]]

- [[Pipe Confirmacao]]

- [[Pipe WhatsApp]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[Scripts e Comandos]]
- [[Integracoes]]
- [[Modulos]]
- [[00 - INDEX]]

## Notas do agente

> Fonte: `CLAUDE.md`, migrations SQL (pg_cron), edge functions, hooks.
> O debounce de 2s no realtime pode causar "lag" perceptivel na UI - e intencional para nao sobrecarregar queries.
