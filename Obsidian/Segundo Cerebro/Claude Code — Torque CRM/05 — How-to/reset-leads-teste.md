---
type: howto
title: Reset Leads de Teste
status: draft
created: 2026-05-15
updated: 2026-05-15
tags: [howto, teste, leads, cleanup]
related: ["[[Schema]]"]
owner: gabriel
---

# Como resetar leads de teste de uma org

> Útil em UAT, demos, ou após teste de carga. **Nunca executar em org de
> cliente sem autorização explícita.**

## Ordem de DELETE (respeitando FKs)

```sql
-- 1. Lead-related tables (filhos)
DELETE FROM lead_tags        WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = $1);
DELETE FROM pipe_whatsapp    WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = $1);
DELETE FROM pipe_confirmacao WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = $1);
DELETE FROM pipe_propostas   WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = $1);
DELETE FROM custom_pipe_entries WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = $1);
DELETE FROM follow_ups       WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = $1);
DELETE FROM lead_history     WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = $1);

-- 2. Conversations + messages
DELETE FROM conversation_messages
  WHERE conversation_id IN (SELECT id FROM conversations WHERE organization_id = $1);
DELETE FROM conversations WHERE organization_id = $1;
DELETE FROM channel_messages WHERE organization_id = $1;

-- 3. Leads (pai)
DELETE FROM leads WHERE organization_id = $1;
```

Substituir `$1` pelo `organization_id` real. **Sempre filtrar por org**.

## Via Supabase Studio

1. SQL Editor
2. Cole script acima
3. Substitua `$1` pelo `organization_id`
4. **Verificar count antes**: `SELECT count(*) FROM leads WHERE organization_id = '<id>';`
5. Executar transaction (BEGIN; ... COMMIT;)

## Via psql

```bash
psql "$DB_URL" -v org="'$ORG_ID'" -f scripts/reset-leads-test.sql
```

(script TODO criar)

## Gotchas

- **`leads` tem FK em `team_members` (responsible/sdr/closer)** — DELETE não
  precisa tocar team_members.
- **`upsell` tem FK RESTRICT em leads** — se org tem upsell, falha.
  Fix: `DELETE FROM upsell WHERE lead_id IN (...)` antes de leads. (Ver
  changelog 2026-05-06.)
- **`workflow_executions` tem `lead_id` opcional** — limpar separadamente:
  ```sql
  DELETE FROM workflow_executions
    WHERE organization_id = $1 AND lead_id IS NOT NULL;
  ```
- **Webhooks pendentes** podem reentrar leads: pausar webhook source antes
  ou aceitar reingestão.

## Confirmação obrigatória

Antes de rodar em qualquer org com >100 leads:
```sql
SELECT count(*) FROM leads WHERE organization_id = '<id>';
```

Se >1000 leads e org não é Milennials/teste, **abortar** e confirmar com CTO.
