# campaign-rule-dispatch

Edge Function que processa a fila `scheduled_campaign_messages` — mensagens agendadas pelas regras de envio por etapa das campanhas.

## O que faz

1. Busca `scheduled_campaign_messages` com `status = 'scheduled'` e `scheduled_at <= now()`
2. Para cada mensagem: obtém lead, template e instância WhatsApp
3. Envia via Evolution API (texto ou áudio)
4. Atualiza status e registra em `outbound_dispatch_log`
5. Respeita rate limit por organização

## Autenticação

A função aceita:

- **Header `x-cron-secret`**: valor igual ao secret `CRON_SECRET` configurado nas Edge Function Secrets
- **JWT de admin**: usuário autenticado com role `admin` em `team_members`

## Secrets obrigatórias

| Secret | Descrição |
|--------|-----------|
| `EVOLUTION_API_URL` | URL da Evolution API |
| `EVOLUTION_API_KEY` | Chave da Evolution API |
| `CRON_SECRET` | (Opcional) Secret para chamadas do cron. Se definido, as chamadas devem enviar `x-cron-secret` com esse valor |

## Processamento automático: pg_cron

Se o projeto tiver **pg_cron** e **pg_net** habilitados:

1. Execute o script `supabase/scripts/setup_campaign_rule_dispatch_cron.sql` no SQL Editor
2. Substitua `PROJECT_REF` e `cron_secret` pelos valores corretos
3. O job roda a cada minuto (`* * * * *`)

Verifique em **Database → Cron Jobs** (ou Integrations → Cron) se o job `campaign-rule-dispatch` está listado.

## Alternativas sem pg_cron

Se o plano Free do Supabase não incluir pg_cron ou pg_net, use uma das opções abaixo.

### 1. n8n (recomendado)

Workflow com **Schedule Trigger** + **HTTP Request**:

- **Schedule**: a cada 1 minuto (`*/1 * * * *`)
- **HTTP Request**:
  - Method: `POST`
  - URL: `https://PROJECT_REF.supabase.co/functions/v1/campaign-rule-dispatch`
  - Headers: `x-cron-secret: SEU_CRON_SECRET`

### 2. GitHub Actions

Crie `.github/workflows/campaign-rule-dispatch.yml`:

```yaml
name: Campaign Rule Dispatch

on:
  schedule:
    - cron: '* * * * *'  # A cada minuto
  workflow_dispatch:

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - name: Invoke campaign-rule-dispatch
        run: |
          curl -X POST \
            -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json" \
            "https://PROJECT_REF.supabase.co/functions/v1/campaign-rule-dispatch"
```

Adicione `CRON_SECRET` em **Settings → Secrets and variables → Actions**.

### 3. Vercel Cron (se o app frontend estiver na Vercel)

Em `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/campaign-rule-dispatch",
      "schedule": "* * * * *"
    }
  ]
}
```

Crie a rota API que chama a Edge Function:

```typescript
// app/api/cron/campaign-rule-dispatch/route.ts
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const res = await fetch(
    `${process.env.SUPABASE_URL}/functions/v1/campaign-rule-dispatch`,
    {
      method: 'POST',
      headers: { 'x-cron-secret': process.env.CRON_SECRET! },
    }
  );
  const data = await res.json();
  return Response.json(data);
}
```

## Disparo manual

Na UI da campanha, o botão **"Processar fila agora"** invoca esta função com o JWT do usuário (admin). Não exige `x-cron-secret`.

Também pode testar via curl:

```bash
curl -X POST "https://PROJECT_REF.supabase.co/functions/v1/campaign-rule-dispatch" \
  -H "x-cron-secret: SEU_CRON_SECRET" \
  -H "Content-Type: application/json"
```

## Resposta

```json
{
  "success": true,
  "processed": 3,
  "sent": 2,
  "failed": 1
}
```

Ou quando não há mensagens pendentes:

```json
{
  "success": true,
  "message": "No pending messages",
  "processed": 0
}
```
