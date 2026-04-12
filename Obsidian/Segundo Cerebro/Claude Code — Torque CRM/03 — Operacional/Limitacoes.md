---
tags:
  - claude-code
  - operacional
  - torque-crm
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Limitacoes, Gotchas e Areas Frageis

## Resumo

Documentacao de tudo que pode dar errado, areas que requerem cuidado extra, e workarounds conhecidos. Leia antes de mexer em qualquer area critica.

## Areas frageis (bugs recorrentes)

### Copilot (agentes IA)

> [!danger] Area de maior risco
> Fluxo que mais gera confusao com usuarios e bugs recorrentes.

**Ao mexer aqui, SEMPRE:**
- Testar fluxo completo: criar agente → configurar → ativar → conversar com lead
- Verificar edge cases: agente sem business_context, lead sem telefone, conversation sem messages
- Checar se a UI deixa claro o que cada config faz (usuarios se perdem)

**Arquivos chave:**
- `src/components/copilot/` — UI do copilot wizard e config
- `src/hooks/useCopilotAgents.ts` — CRUD de agentes
- `supabase/functions/agent-message/` — Processamento de mensagem
- `supabase/functions/_shared/ai-action-executor.ts` — Executor de acoes IA
- `supabase/functions/outbound-trigger/` — Disparo outbound

### Permissoes

> [!warning] 3 camadas = 3x chances de bug

**Ao mexer aqui:**
- Testar com role `admin`, `membro`, e `master` separadamente
- Verificar RLS policies + `feature_permissions` + `member_feature_permissions`
- Checar o hook `useCanPerformAction()` e o RPC `check_action_allowed`

**Arquivos chave:**
- `src/lib/permissions.ts` — Engine de permissoes frontend
- `supabase/functions/_shared/permission_engine.ts` — Engine backend
- `src/hooks/useUserRole.ts` — Role do usuario logado
- `tests/integration/permission-engine.test.ts` — Testes de integracao

## Gotchas tecnicos

### JWT em edge functions

Todas as 52 edge functions usam `verify_jwt = false` no `config.toml`. Autenticacao e feita internamente via headers customizados:
- `x-webhook-key` (webhooks externos)
- `x-cron-secret` (cron jobs)
- Bearer token manual (funcoes autenticadas)

> [!danger] Double negative trap
> `--no-verify-jwt=false` na CLI **HABILITA** JWT (double negative).
> Usar `verify_jwt = false` no `config.toml` ao inves de flags CLI.

### Supabase types

O arquivo `src/integrations/supabase/types.ts` tem 270KB e e auto-gerado. Nunca editar manualmente. Regenerar com:
```bash
supabase gen types typescript --project-id jsjsmuncfkbsbzqzqhfq > src/integrations/supabase/types.ts
```

### pg_net

- Disponivel **apenas** no Supabase, nao existe no RDS Aurora
- Edge functions cron dependem dele para HTTP POST
- Se pg_net falhar, todos os cron jobs param silenciosamente

### Realtime handlers

- `onUpdate` recebe **apenas campos alterados**, nao o row completo com joins
- Dados aninhados (lead_tags, responsible) vem do cache do React Query
- Debounce de 2s pode causar "lag" perceptivel

### Body parameters no n8n

- Valores sao **sempre strings** no n8n
- Para enviar arrays (ex: tags), usar JSON body
- Ou a edge function precisa normalizar strings → arrays

### Build chunks

- Vite split manual configurado em `vite.config.ts`
- Se adicionar dependencia grande, adicionar em `manualChunks`
- Chunks atuais: vendor, supabase, charts, motion, query, dnd

### Testes de integracao

- Precisam de Supabase local rodando (`supabase start`)
- CI faz isso automaticamente
- Se falhar localmente: verificar se containers Docker estao rodando

### Env files (prioridade Vite)

```
npm run dev  → .env.local > .env.development > .env
npm run build → .env.local > .env.production > .env
```

## Limitacoes conhecidas

### Escala

- ~30 orgs ativas (crescendo diariamente)
- Time: CTO + 1 dev junior
- Sem autoscaling — VPS Hostinger com Docker

### Dependencias criticas

- **pg_net**: Se cair, todos os cron jobs param
- **Evolution API**: Unico canal WhatsApp — sem fallback
- **Supabase**: Vendor lock-in (auth, storage, realtime, edge functions)
- **n8n**: 20+ workflows de ingestao — se n8n cair, leads nao entram

### Seguranca

- Service role key nunca no frontend
- RLS em todas as tabelas com org_id
- JWT interno nas edge functions (nao Supabase Auth JWT)
- Dominio de producao: `torquecrm.com.br` (CORS/ALLOWED_ORIGINS)

## Workarounds documentados

| Problema | Workaround |
|----------|-----------|
| Tags como string no n8n | Edge function normaliza string → array |
| JWT verify na CLI | Usar config.toml, nunca flags CLI |
| Types desatualizados | Regenerar com `supabase gen types` |
| Realtime sem joins | Usar cache React Query para dados aninhados |
| Audio cross-browser | Conversao OGG/WebM → MP3 via API service |
| CORS audio Supabase | Configuracao de bucket CORS separada |

## Links relacionados

- [[Permissoes]]
- [[Comportamentos]]
- [[Visao Geral]]
- [[00 — INDEX]]

## Notas do agente

> Fonte: `CLAUDE.md` (secoes Gotchas e Areas frageis), `docs/`, exploracoes.
> A integracao Cal.com (`webhook-calcom`) existe nos edge functions mas NAO esta documentada no CLAUDE.md — status incerto.
> A funcao `cadastro-externo-push` tambem nao esta documentada — pode ser feature em progresso.
