# process-outbound-dispatches

Worker que processa a fila `outbound_dispatch_log` — disparos Copilot agendados com `delayMinutes > 0`.

## O que faz

1. Busca registros com `status = 'pending'` e `scheduled_at <= now()`
2. Filtra apenas disparos Copilot (`agent_id IS NOT NULL`)
3. Envia cada mensagem via Evolution API (via `_shared/outbound-sender.ts`)

## Autenticação

- **Cron:** Header `x-cron-secret` deve coincidir com a variável `CRON_SECRET` nas Edge Functions
- Sem esse header correto, retorna 401 Unauthorized

## Configurar Cron (Supabase pg_cron)

### 1. Habilitar extensões (OBRIGATÓRIO antes do cron)

Se você recebe `schema "cron" does not exist`, as extensões não estão habilitadas.

**No Supabase Dashboard:**
1. Vá em **Database** → **Extensions**
2. Procure **pg_cron** → clique em **Enable**
3. Procure **pg_net** → clique em **Enable**

> Planos gratuitos podem ter restrições. Se não conseguir habilitar, use a alternativa externa (GitHub Actions, etc.).

### 2. Rodar a migration

A migration `20260312000000_process_outbound_dispatches_cron.sql` cria:
- A função `invoke_process_outbound_dispatches()` que chama a Edge Function
- O job cron agendado para `*/5 * * * *` (a cada 5 min)

Rode as migrations ou execute o SQL manualmente.

### 3. Configurar URL e secret em `cron_config`

Substitua `PROJECT_REF` (ex: `xyzabc123`) e `seu-cron-secret` pelo valor real do `CRON_SECRET` das Edge Functions:

```sql
INSERT INTO public.cron_config (key, value) VALUES
  ('process_outbound_dispatches_url', 'https://PROJECT_REF.supabase.co/functions/v1/process-outbound-dispatches'),
  ('cron_secret', 'seu-cron-secret')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

> Se `cron_secret` já existir (de webhooks ou campaign-rule-dispatch), pode usar o mesmo valor.

### 4. Conferir

- **Integrations** → **Cron** no Dashboard: o job `process-outbound-dispatches` deve aparecer
- A cada 5 min o job chama a Edge Function e processa a fila

---

## Alternativa: Serviço externo (sem pg_cron)

Se `pg_cron` não estiver disponível no seu plano:

```bash
# Exemplo: GitHub Actions, Vercel Cron, ou cron do servidor
curl -X POST "https://PROJECT_REF.supabase.co/functions/v1/process-outbound-dispatches" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{}'
```

Agende essa chamada a cada 5 minutos.

## Variáveis de ambiente

- `CRON_SECRET` — Obrigatória para autorizar execuções via cron
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — Automáticas no Supabase
- `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` — Necessárias para envio via WhatsApp (usadas pelo `outbound-sender`)
