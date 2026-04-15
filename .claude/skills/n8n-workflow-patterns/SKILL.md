---
name: n8n-workflow-patterns
description: Patterns and best practices for building n8n workflows — Trello ingestion, data transformation, conditional routing, error handling, and retry logic. Used by agent-automation.
---

# n8n Workflow Patterns — Torque CRM

Guia de patterns para construir e manter workflows n8n no contexto do Torque CRM. Usado pelo agent-automation como referencia de implementacao.

## Contexto do Projeto

O Torque CRM usa n8n como orquestrador de ingestao de leads. Existem 20+ workflows seguindo o padrao Trello → n8n → lead-webhook. Cada cliente tem seu board Trello e workflow dedicado.

## Pattern Principal: Trello → lead-webhook

```
Trello Trigger (board watch)
  → Set node (extract fields from card)
    → Code node (parse desc via regex: nome, telefone, empresa, faturamento)
      → Switch node (classificar por faturamento → tag)
        → HTTP Request (POST lead-webhook)
```

### Campos obrigatorios no POST

```json
{
  "source": "trello",
  "organization_id": "uuid-do-cliente",
  "fields": {
    "name": "Nome do Lead",
    "phone": "+5511999999999",
    "email": "email@empresa.com",
    "company": "Empresa Ltda"
  },
  "tags": ["Ouro"],
  "place_in_pipe": {
    "pipe": "whatsapp",
    "stage": "novo_lead"
  },
  "assigned_user_id": "uuid-do-responsavel"
}
```

### Tags por faturamento (padrao)

| Faixa | Tag |
|-------|-----|
| < R$500k | Latao |
| R$500k - R$2M | Prata |
| R$2M - R$10M | Ouro |
| > R$10M | Diamante |

## Patterns de Resiliencia

### Retry em HTTP Request

- **Retry on Fail**: Sempre habilitado
- **Max Tries**: 3
- **Wait Between Tries**: 2000ms (exponential backoff)
- **Retry on**: 429, 500, 502, 503, 504

### Error Handling

```
Workflow principal
  → Error Trigger (workflow-level)
    → Set node (contexto do erro: workflow_id, node_name, error_message)
      → HTTP Request (POST para endpoint de logging ou Slack)
```

- SEMPRE ter Error Trigger no workflow
- SEMPRE logar contexto suficiente: qual lead falhou, qual node, qual erro
- NUNCA silenciar erros

### Deduplicacao

- Usar `update_existing_if_match: true` no payload do lead-webhook
- Checar por telefone como chave natural de deduplicacao
- Se o card Trello foi atualizado (nao criado), enviar como update

## Patterns de Data Transformation

### Regex para extrair dados do desc do Trello

```javascript
// Code node - extrair campos do card description
const desc = $json.desc || '';

const phoneMatch = desc.match(/(?:tel|fone|whats)[:\s]*(\+?\d[\d\s()-]{8,})/i);
const companyMatch = desc.match(/(?:empresa|company)[:\s]*(.+?)(?:\n|$)/i);
const revenueMatch = desc.match(/(?:faturamento|receita|revenue)[:\s]*R?\$?\s*([\d.,]+)/i);

return {
  phone: phoneMatch ? phoneMatch[1].replace(/\D/g, '') : null,
  company: companyMatch ? companyMatch[1].trim() : null,
  revenue: revenueMatch ? parseFloat(revenueMatch[1].replace(/\./g, '').replace(',', '.')) : null
};
```

### Normalizacao de telefone

```javascript
// Garantir formato E.164
let phone = $json.phone.replace(/\D/g, '');
if (phone.length === 11) phone = '55' + phone;  // BR sem codigo pais
if (phone.length === 10) phone = '5511' + phone; // Sem DDD (assume SP)
if (!phone.startsWith('+')) phone = '+' + phone;
return { phone };
```

## Patterns de Conditional Routing

### Switch por source

```
Switch node:
  - Value: {{ $json.source }}
  - Routes:
    - "meta_ads" → processamento Meta
    - "trello" → processamento Trello
    - "google_ads" → processamento Google
    - default → fallback generico
```

### IF por campo obrigatorio

```
IF node:
  - Condition: {{ $json.fields.phone }} is not empty
  - True → continua pipeline
  - False → log de lead sem telefone (nao envia pro webhook)
```

## Regras

- SEMPRE usar `update_existing_if_match: true` pra evitar duplicatas
- SEMPRE normalizar telefone pra formato E.164 antes de enviar
- SEMPRE ter Error Trigger com logging
- SEMPRE retry em HTTP Request nodes
- NUNCA hardcodar organization_id — usar variavel de ambiente ou credentials
- NUNCA enviar lead sem telefone (campo obrigatorio no sistema)
- NUNCA ignorar o campo `source` — rastreabilidade depende dele
- CUIDADO: valores no body do n8n sao sempre strings. Arrays devem ser JSON stringified ou a edge function normaliza
