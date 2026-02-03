# Referência de campos da API para n8n (HTTP node)

## Objetivo
Documentar os **nomes e IDs dos campos** do sistema (lead, card do lead, campanhas) para preencher corretamente ao enviar dados do n8n (ex.: leads do Meta Ads/Facebook Ads) via HTTP.

---

## 1. Campos fixos do lead (tabela `leads`)

Estes são os **nomes exatos das colunas** para usar no body da requisição (ex.: PATCH/POST no Supabase ou no webhook de leads).

| Nome do campo (API) | Tipo   | Uso no n8n |
|---------------------|--------|------------|
| `name`              | string | Nome do lead |
| `phone`             | string | Telefone |
| `email`             | string | E-mail |
| `company`           | string | Empresa |
| `notes`             | string | Observações do lead (card do lead) |
| `origin`            | string | Origem (ex.: `meta_ads`, `outro`, `whatsapp`) |
| `segment`           | string | Segmento |
| `faturamento`       | number | Faturamento |
| `urgency`           | string | Urgência |
| `rating`            | number | Rating (0–10) |
| `utm_campaign`      | string | Campanha UTM |
| `utm_source`        | string | UTM source |
| `utm_medium`        | string | UTM medium |
| `utm_content`       | string | UTM content |
| `utm_term`          | string | UTM term |
| `sdr_id`            | UUID   | ID do SDR (team_member) |
| `closer_id`         | UUID   | ID do closer (team_member) |
| `pipe_whatsapp`     | string | Etapa no funil WhatsApp |
| `organization_id`  | UUID   | Obrigatório em inserts (não alterar via integração) |

**Não enviar em updates:** `id`, `created_at`, `updated_at`, `normalized_phone`, `ai_disabled` (a menos que seja intencional).

---

## 2. Campos customizados do lead (card do lead)

Os campos adicionais que você cria no sistema (ex.: "Interesse", "Orçamento") ficam em duas tabelas:

- **`lead_custom_fields`** – definição do campo: `id`, `field_name`, `field_type`, `organization_id`, etc.
- **`lead_custom_field_values`** – valor por lead: `lead_id`, `field_id`, `value`.

### Como descobrir o **nome** ou **ID** do campo

**Opção A – Listar pela API (Supabase)**  
Chame a API do Supabase para listar os campos da organização:

- **Método:** GET  
- **URL:** `{{SUPABASE_URL}}/rest/v1/lead_custom_fields?organization_id=eq.{{ORGANIZATION_ID}}`  
- **Headers:** `apikey`, `Authorization: Bearer {{SUPABASE_ANON_OR_SERVICE_KEY}}`, `Content-Type: application/json`

A resposta traz algo como:

```json
[
  { "id": "uuid-do-campo-1", "field_name": "Interesse", "field_type": "text", ... },
  { "id": "uuid-do-campo-2", "field_name": "Orçamento", "field_type": "text", ... }
]
```

- **`field_name`** – nome exibido no card (ex.: "Interesse", "Orçamento"). Use este nome no **webhook de leads** (ver abaixo).  
- **`id`** – UUID do campo. Use este **`field_id`** quando for gravar direto na tabela `lead_custom_field_values`.

**Opção B – Pela interface**  
No sistema, ao criar/editar um campo personalizado, o nome que você digita é o `field_name`. Para pegar o `id`, use a Opção A (API) ou inspecione a rede (DevTools) ao salvar o lead.

### Enviar valores de campos customizados

**Se usar o webhook de leads** (recomendado para n8n):

O payload aceita em `fields` qualquer chave além de `name`, `phone`, `email`, `company`. Essas chaves extras são tratadas como **campos personalizados** e o backend usa o **nome do campo** (`field_name`). Se não existir um campo com esse nome na organização, um novo é criado (tipo `text`).

Exemplo de body no n8n (HTTP Request):

```json
{
  "source": "meta_ads",
  "fields": {
    "name": "João Silva",
    "phone": "+5511999999999",
    "email": "joao@email.com",
    "company": "Empresa X",
    "Interesse": "Produto A",
    "Orçamento": "10k-50k"
  },
  "tags": ["facebook-lead"],
  "organization_id": "uuid-da-organizacao"
}
```

As chaves `"Interesse"` e `"Orçamento"` devem ser **exatamente iguais** ao `field_name` cadastrado no sistema (case-sensitive).

**Se chamar direto o Supabase** (insert/upsert em `lead_custom_field_values`):

- Você precisa do **`field_id`** (UUID) de cada campo.
- Body de cada valor: `lead_id`, `field_id`, `value`.
- Endpoint de upsert: `POST .../rest/v1/lead_custom_field_values` com header `Prefer: resolution=merge-duplicates` e conflito em `lead_id,field_id`.

---

## 3. Observações em campanhas (card do lead na campanha)

As "observações" que aparecem no card do lead **dentro de uma campanha** ficam na tabela **`campanha_leads`**, na coluna **`notes`**.

- **Nome do campo na API:** `notes`
- **Tabela:** `campanha_leads`
- **Registro:** cada linha é a participação de um lead em uma campanha (não é o lead em si). O `id` usado no update é o **id do registro em `campanha_leads`** (não o `lead_id`).

Para **atualizar as observações** de um lead em uma campanha via HTTP:

1. Descobrir o **`id`** do registro em `campanha_leads` (onde `lead_id` = lead desejado e `campanha_id` = campanha desejada).
2. Fazer PATCH (ou PUT) na API Supabase:
   - **URL:** `{{SUPABASE_URL}}/rest/v1/campanha_leads?id=eq.{{CAMPANHA_LEAD_ID}}`
   - **Body:** `{ "notes": "Texto das observações aqui" }`

No n8n, você pode:
- Antes: um GET em `campanha_leads?lead_id=eq.{{lead_id}}&campanha_id=eq.{{campanha_id}}` para obter o `id` da linha.
- Depois: um PATCH em `campanha_leads` com esse `id` e `notes`.

---

## Resumo rápido para o n8n

| O que preencher              | Onde              | Nome/ID a usar |
|-----------------------------|-------------------|----------------|
| Nome, telefone, email, etc. | Lead (webhook ou `leads`) | Nomes da tabela 1 acima (`name`, `phone`, `notes`, …) |
| Campos extras do card do lead | Webhook `fields`  | **field_name** exato (ex.: `"Interesse"`, `"Orçamento"`) |
| Campos extras (Supabase direto) | `lead_custom_field_values` | **field_id** (UUID de `lead_custom_fields`) |
| Observações na campanha     | `campanha_leads`  | Coluna **`notes`**; filtro/update pelo **`id`** do registro em `campanha_leads` |
| Evitar duplicar por telefone/email | Webhook body     | Enviar **`update_existing_if_match: true`** (padrão = sempre cria novo lead) |

---

## Endpoints úteis

- **Listar campos customizados:**  
  `GET {{SUPABASE_URL}}/rest/v1/lead_custom_fields?organization_id=eq.{{ORG_ID}}`
- **Webhook de leads (criar/atualizar lead + campos):**  
  `POST {{SUPABASE_URL}}/functions/v1/lead-webhook`  
  Headers: `x-webhook-key: {{WEBHOOK_API_KEY}}`, `Content-Type: application/json`
- **Atualizar lead:**  
  `PATCH {{SUPABASE_URL}}/rest/v1/leads?id=eq.{{LEAD_ID}}`
- **Atualizar observações na campanha:**  
  `PATCH {{SUPABASE_URL}}/rest/v1/campanha_leads?id=eq.{{CAMPANHA_LEAD_ID}}`  
  Body: `{ "notes": "..." }`

---

## Exemplo JSON: lead entrando em campanha com notes

Payload para o **webhook de leads** (`POST .../functions/v1/lead-webhook`) quando o lead já cai direto numa campanha e você quer preencher as **observações** do card na campanha. Use o header `x-webhook-key: {{WEBHOOK_API_KEY}}`.

Substitua os UUIDs e textos pelos seus valores reais: `campaign_id` e `stage_id` vêm da campanha/etapa no sistema.

- **Comportamento padrão:** o webhook **sempre cria um novo lead** (cada requisição = um lead novo).
- **`update_existing_if_match`** (opcional): se `true`, **evita duplicar**: busca por telefone/email e, se encontrar, atualiza o lead existente em vez de criar outro. Use quando quiser que o mesmo número não vire dois leads.

```json
{
  "source": "meta_ads",
  "campaign_name": "Campanha Facebook Q1",
  "organization_id": "uuid-da-sua-organizacao",
  "fields": {
    "name": "Maria Santos",
    "phone": "+5511988887777",
    "email": "maria@empresa.com",
    "company": "Empresa XYZ",
    "Interesse": "Produto Premium",
    "Orçamento": "10k-50k"
  },
  "tags": ["facebook-lead", "campanha-q1"],
  "place_in_campaign": {
    "campaign_id": "uuid-da-campanha",
    "stage_id": "uuid-da-etapa-da-campanha",
    "notes": "Lead quente. Pediu retorno em 24h. Interesse em demo."
  }
}
```

- **`place_in_campaign.campaign_id`** – ID (UUID) da campanha no sistema.
- **`place_in_campaign.stage_id`** – ID (UUID) da etapa (stage) da campanha onde o lead deve entrar.
- **`place_in_campaign.notes`** – texto que aparece como **observações** no card do lead dentro da campanha.

Se o lead já existir e já estiver nessa campanha, o webhook atualiza a etapa e as **notes**. Se for novo na campanha, insere com **notes** já preenchidas.
