# process-copilot-followups

Worker que processa regras de follow-up do Copilot (`trigger_type = 'no_response'`).

## Trigger

Um lead **qualifica** quando:

1. Existe conversa ativa em `whatsapp_messages`
2. **Última mensagem é nossa** (`direction = 'outgoing'`)
3. **Tempo sem resposta** ≥ `trigger_delay_hours` + `trigger_delay_minutes`
4. **Filtros** da regra passam (tags, origens, pipes, stages)
5. **Max follow-ups** não atingido (por regra, em `copilot_followup_execution_log`)
6. **Horário comercial** OK (`getNextSendTime` ≤ now)

## Autenticação

- Header `x-cron-secret` = `CRON_SECRET` das Edge Functions

## Configurar Cron (pg_cron)

1. **Habilitar** `pg_cron` e `pg_net` no Dashboard (Database → Extensions)
2. **Rodar** as migrations (20260313000000, 20260313000001, 20260313000002)
3. **Inserir** em `cron_config`:

```sql
INSERT INTO public.cron_config (key, value) VALUES
  ('process_copilot_followups_url', 'https://PROJECT_REF.supabase.co/functions/v1/process-copilot-followups')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

(O `cron_secret` já configurado para outros jobs vale para este também.)

## Variáveis de ambiente

- `CRON_SECRET`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`
