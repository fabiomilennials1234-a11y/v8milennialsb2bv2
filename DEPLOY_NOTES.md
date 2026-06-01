# Deploy Notes — Featurenotificação_copilot

## Migration obrigatória

Antes de testar ou deployar esta feature, rodar a migration no banco de produção:

```bash
supabase db push --project-ref jsjsmuncfkbsbzqzqhfq
```

Ou aplicar manualmente via SQL Editor no Supabase Dashboard:

```sql
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS handoff_notify_phones text[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS handoff_notify_instructions text DEFAULT NULL;
```

**Sem esta migration, a feature não funciona** — as novas colunas não existem no banco e o save do agente vai falhar silenciosamente para os campos de notificação.

## Edge functions afetadas

Após merge, fazer deploy das edge functions modificadas:

```bash
supabase functions deploy agent-message --project-ref jsjsmuncfkbsbzqzqhfq
supabase functions deploy process-ai-actions --project-ref jsjsmuncfkbsbzqzqhfq
```

## Regen types (opcional mas recomendado)

```bash
supabase gen types typescript --project-id jsjsmuncfkbsbzqzqhfq > src/integrations/supabase/types.ts
```

---

Arquivo temporário — deletar após deploy.
