# Lead Webhook

Webhook para receber leads (n8n, Meta Ads, Zapier, formulários, etc.). Cria ou atualiza o lead e opcionalmente coloca em um **pipe** (funil) e/ou em uma **campanha** em etapa específica.

## Deploy

Após alterações no código, publique a função no Supabase para que o n8n use a versão nova:

```bash
cd v8milennialsb2b-main
supabase login   # se aparecer "Access token not provided"
supabase link    # vincule ao projeto Supabase correto, se ainda não estiver
supabase functions deploy lead-webhook
```

(O Easypanel faz deploy da aplicação; as Edge Functions são publicadas separadamente no Supabase.)

## Headers

- `Authorization: Bearer <anon_key>` (obrigatório para o gateway Supabase)
- `x-webhook-key: <WEBHOOK_API_KEY>` (obrigatório)
- `Content-Type: application/json`

## Payload

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `source` | Sim | Ex.: `meta_ads`, `n8n`, `landing_page` |
| `origin_detail` | Não | Detalhe textual da origem (ex.: `Cadastro LP Meta`, `Agendamento Automático Meta`). Gravado em `leads.origin_detail` (máx. 120 chars) e exibido ao lado do badge de origem. Em reconversão sobrescreve o valor anterior. |
| `fields` | Sim | Objeto com `name`, `phone`, `email`, `company` (ao menos `phone` ou `email`) |
| `organization_id` | Recomendado | UUID da organização (multi-tenant) |
| `tags` | Não | Array de strings |
| `campaign_name`, `campaign_id` | Não | UTM / nome da campanha de origem |
| **`place_in_pipe`** | Não | Coloca o lead em um funil em uma etapa |
| **`place_in_campaign`** | Não | Coloca o lead em uma campanha em uma etapa |

### place_in_pipe

Coloca o lead direto em um pipe (Qualificação/WhatsApp, Confirmação ou Propostas) em uma etapa.

```json
"place_in_pipe": {
  "pipe": "whatsapp",
  "stage": "novo"
}
```

- **pipe:** `whatsapp` | `confirmacao` | `propostas`
- **stage:** valor do enum do pipe (ver tabela abaixo)

**Etapas por pipe:**

| pipe | stage (valores aceitos) |
|------|-------------------------|
| `whatsapp` | `novo`, `abordado`, `respondeu`, `esfriou`, `agendado` |
| `confirmacao` | `reuniao_marcada`, `confirmar_d3`, `confirmar_d2`, `confirmar_d1`, `pre_confirmada`, `confirmacao_no_dia`, `confirmada_no_dia`, `compareceu`, `perdido` |
| `propostas` | `marcar_compromisso`, `compromisso_marcado`, `esfriou`, `futuro`, `vendido`, `perdido` |

### place_in_campaign

Coloca o lead em uma campanha em uma etapa (ex.: campanha de ads). Requer UUIDs da campanha e do stage (tabela `campanha_stages`).

```json
"place_in_campaign": {
  "campaign_id": "uuid-da-campanha",
  "stage_id": "uuid-do-campanha_stages"
}
```

- **campaign_id:** UUID da campanha (da organização)
- **stage_id:** UUID do estágio da campanha (campanha_stages.id)

**Onde pegar os IDs:** na aplicação, abra **Funis → Campanhas**, clique na campanha desejada e expanda **"IDs para integração (n8n, webhook)"**. Lá aparecem o `campaign_id` e a lista de etapas com nome e `stage_id` (com botão para copiar).

## Exemplo completo (n8n)

```json
{
  "source": "meta_ads",
  "organization_id": "6030520a-2ca7-477d-be89-55758e2cd808",
  "campaign_name": "Campanha Ads Q1",
  "tags": ["ads", "meta"],
  "fields": {
    "name": "Nome do lead",
    "phone": "5511999999999",
    "email": "lead@email.com",
    "company": "Empresa"
  },
  "place_in_pipe": {
    "pipe": "whatsapp",
    "stage": "novo"
  },
  "place_in_campaign": {
    "campaign_id": "uuid-da-campanha-de-ads",
    "stage_id": "uuid-da-etapa-da-campanha"
  }
}
```

Pode enviar só `place_in_pipe`, só `place_in_campaign`, ou ambos. Se omitir os dois, o lead é apenas criado/atualizado (comportamento anterior).

## Cal.com bypass (origin=cal)

Quando `source` ∈ {`cal`, `cal.com`, `calendly`}, o lead já tem reunião agendada. O webhook força o roteamento server-side:

- `place_in_pipe.pipe = "confirmacao"`, `stage = "reuniao_marcada"`.
- `meeting_date` **obrigatório**. Aceito em `place_in_pipe.meeting_date` ou `fields.meeting_date` (ISO 8601). Sem isso → **400**.
- Se o caller mandar `place_in_pipe` apontando pra outro pipe, override server-side + log warning.
- Lead entra direto em **Confirmação / Reunião marcada**, pulando a qualificação WhatsApp.
- Lembretes D-N (`confirmar_d5`, `confirmar_d3`, `confirmar_d2`, `confirmar_d1`) dependem do `meeting_date` — não envie sem ele.

Exemplo mínimo:

```json
{
  "source": "cal",
  "organization_id": "<uuid>",
  "fields": {
    "name": "Nome do lead",
    "phone": "5511999999999",
    "email": "lead@email.com",
    "meeting_date": "2026-06-01T10:00:00Z"
  }
}
```

## Resposta (quando envia `place_in_campaign`)

Além de `success`, `lead_id`, `is_new` e `message`, a resposta pode incluir:

- **`placed_in_campaign`** (boolean): `true` se o lead foi inserido/atualizado em `campanha_leads`; `false` se falhou.
- **`place_in_campaign_error`** (string, opcional): mensagem de erro quando `placed_in_campaign` é `false` (ex.: "Campaign not found or not in org", "Stage not found or not in campaign", ou erro do banco).

Use no n8n para saber se o lead entrou na campanha e, em caso de falha, o motivo.
