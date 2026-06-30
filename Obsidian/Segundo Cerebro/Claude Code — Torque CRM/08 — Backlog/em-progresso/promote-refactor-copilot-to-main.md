---
type: backlog
title: Promote refactor copilot → main
status: shipped
created: 2026-04-27
updated: 2026-04-28
tags: [copilot, refactor, agent-engine, deploy]
related:
  - "[[ADR-2026-04-27-refactor-agent-engine-modular]]"
owner: gabriel
---

# Promote refactor copilot → main

> [!success] RESOLVIDO — promovido a `main`
> O gate foi destravado: o commit final do refactor `fc2c2c9` é **ancestral de `main`** (confirmado via `git merge-base --is-ancestor`), promovido via merges `develop → main` em 2026-04-28 (`4fe03ee3`, `1a2a09be`, `77ff7386`). O módulo `supabase/functions/agent-message/engine/` está vivo em `main` e recebeu ~6 meses de trabalho subsequente em cima (ex.: #865, #837, #714). Os bloqueadores abaixo (schema dev + smoke E2E) ficam como registro histórico do plano original. **Nota:** este card estava marcado como CTO-gated, mas a evidência de git mostra a promoção concluída — drift corrigido.

**Status**: ✅ Promovido a `main` (refactor live; ver banner acima)
**Aberto em**: 2026-04-27
**Branch**: `develop` (commit final `fc2c2c9`) → mergeado em `main`
**Risco**: Médio (mexe no coração do copilot, mas comportamento byte-a-byte preservado e validado)

## Contexto

Refactor modular do copilot completo no `develop` (ver [[ADR-2026-04-27-refactor-agent-engine-modular]]). 13 commits. ~14k linhas movimentadas. Zero regressão de teste. Deploy em DEV (project `bcfadphgsibjzivtbjvc`) bem-sucedido.

`main` está intacto em `0aa3f5f`. Decisão explícita do CTO de NÃO pushar pra main até smoke E2E real validar o pipeline ponta-a-ponta em dev.

## Bloqueadores

### 1. Schema dev defasado (24 migrations pendentes)

`supabase migration list` mostra 24 migrations locais sem aplicação remota em dev. Mais relevantes pro refactor:
- `20260919000000` (não identificado ainda)
- `20260920000000_copilot_behavior_windows.sql`
- `20260921000000_workflow_wait_business_window_v2.sql`

**Sintoma observado**: query `SELECT_AGENT` em `_shared/copilot/context-loader.ts` (`*, copilot_agent_faqs(*), copilot_agent_kanban_rules(*)`) falha com `PGRST200 — Searched for a foreign key relationship between copilot_agents and copilot_agent_faqs in the schema public, but no matches were found.`

**Fix**:
```bash
supabase db push --linked --project-ref bcfadphgsibjzivtbjvc
```

Revisar migrations antes — algumas podem ter side effects.

### 2. Smoke E2E real do agent-message em dev

Após bloqueador #1 resolvido:

1. Criar smoke agent + lead em dev (script pronto em `tests/unit/refactor-smoke.test.ts`):
   ```sql
   -- Agent
   INSERT INTO copilot_agents (organization_id, created_by, name, template_type, system_prompt, main_objective, is_active, is_default, can_qualify_lead, can_transfer_human, can_update_lead, availability)
   VALUES ('6030520a-2ca7-477d-be89-55758e2cd808', 'a5064ef9-0f7e-4d1a-a510-0ce2729a8d62', 'Smoke E2E', 'qualificador', 'Voce e agente teste...', 'Smoke', true, true, true, true, true, '{"mode":"always","timezone":"America/Sao_Paulo"}');

   -- Lead
   INSERT INTO leads (organization_id, name, phone, email, origin, pipe_whatsapp)
   VALUES ('6030520a-2ca7-477d-be89-55758e2cd808', 'Smoke Lead', '5511999990000', 'smoke@torque.test', 'outro', 'novo');
   ```

2. Disparar agent-message:
   ```bash
   curl -X POST "https://bcfadphgsibjzivtbjvc.supabase.co/functions/v1/agent-message" \
     -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" \
     -d '{"organization_id":"...","from":"5511999990000","channel":"whatsapp","message":"Oi","push_name":"Smoke Lead","incoming_message_type":"text"}'
   ```

3. Verificar tabelas:
   - `conversations.state` deve avançar (`NEW_LEAD` → `QUALIFYING`)
   - `conversations.turn_count` deve incrementar
   - `conversation_messages` deve ter user + assistant entries
   - `pending_ai_actions` deve ter eventual tool call enfileirada
   - `runtime_logs` deve ter `action='prompt_built'` com `prompt_chars > 0`
   - `lead_history` deve receber side-effects (se houver)

4. Repetir 1-2 turnos pra validar history loading.

5. Limpar entities de teste.

## Plano de promoção

Quando bloqueadores resolvidos:

```bash
# 1. Aplicar migrations dev
supabase db push --linked

# 2. Smoke E2E real (ver acima)

# 3. Push develop → main
git push origin develop:main

# 4. Deploy edge functions prod
supabase functions deploy agent-message process-ai-actions \
  --project-ref jsjsmuncfkbsbzqzqhfq

# 5. Aplicar migrations em prod (se aplicável)
# Cuidado: prod tem 30 orgs ativas. Migrations DDL aditivas OK,
# DDL destrutivas precisam plano de janela.
supabase db push --linked --project-ref jsjsmuncfkbsbzqzqhfq
```

## Monitoramento pós-deploy (primeiras 24h em prod)

- **Sentry**: zero novos `import` ou `cannot find module` errors nos paths refatorados.
- **runtime_logs**: `action='prompt_built'` populado (não cair pra zero) → indica `agent-message` executando.
- **pending_ai_actions**: `status='processed'` aumentando normalmente → indica `process-ai-actions` consumindo fila.
- **Tempo de resposta agent-message**: p50 ~3-4s (baseline pré-refactor). Se subir +50%, investigar.
- **conversation_messages**: contagem aumentando → conversas reais acontecendo.

## Rollback

Se regressão crítica em prod:

```bash
# Hard rollback pra commit pré-refactor
git push origin --force-with-lease 0aa3f5f:main

# Re-deploy edge functions (volta versão antiga)
supabase functions deploy agent-message process-ai-actions \
  --project-ref jsjsmuncfkbsbzqzqhfq
```

Migrations DDL aditivas NÃO precisam revert (são compatíveis com código antigo).

## Refs

- [[ADR-2026-04-27-refactor-agent-engine-modular]]
- [[2026-04-27-refactor-copilot-modules]]
- [[Copilot]]
