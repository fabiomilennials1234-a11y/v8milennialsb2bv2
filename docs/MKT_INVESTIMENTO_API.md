# API de Investimento por Campanha (MKT)

Documentação do contrato para preenchimento do investimento na campanha via API (fase 2 / opcional).

## Objetivo

Permitir que sistemas externos (ex.: Meta Ads, Google Ads, n8n, webhooks) atualizem o valor de investimento de uma campanha, sem preenchimento manual no sistema.

## Modelo de dados

- **Tabela:** `campanhas`
- **Colunas:**
  - `investimento_cents` (BIGINT, nullable): valor em centavos (ex.: 10000 = R$ 100,00)
  - `investimento_updated_at` (TIMESTAMPTZ, nullable): última atualização
  - `investimento_source` (TEXT): `'manual'` ou `'api'`

Ao atualizar via API, o endpoint deve setar `investimento_source = 'api'` e `investimento_updated_at = now()`.

## Contrato sugerido (webhook genérico)

### POST `/functions/v1/update-campaign-investment` (Supabase Edge Function)

**Headers:**
- `Authorization: Bearer <SUPABASE_ANON_KEY ou SERVICE_ROLE_KEY>`
- `Content-Type: application/json`

**Body:**
```json
{
  "campaign_id": "uuid-da-campanha",
  "investimento_cents": 15000,
  "source": "api"
}
```

- `campaign_id` (obrigatório): UUID da campanha.
- `investimento_cents` (obrigatório): valor em centavos. Use `null` para limpar.
- `source`: opcional; default `"api"`.

**Respostas:**
- `200`: sucesso; body com a campanha atualizada.
- `400`: payload inválido (campaign_id ausente, etc.).
- `403`: campanha não pertence à organização do token / RLS.
- `404`: campanha não encontrada.

**Segurança:**
- Validar que a campanha pertence à organização autorizada pelo token (RLS ou checagem por `organization_id`).
- Não expor chave service_role em clientes; usar apenas em server-to-server ou Edge Function com auth.

## Integrações específicas (futuro)

- **Meta Ads / Google Ads:** mapear `campaign_id` do sistema a `external_campaign_id` do provedor e sincronizar gastos via API do provedor em job agendado.
- **n8n / Zapier:** webhook que chama o endpoint acima com `investimento_cents` calculado no fluxo.

## Notas

- A soma de `investimento_cents` de todas as campanhas (ou filtradas por origem) é usada na página Marketing para custo por reunião e custo por venda.
- A origem do dado (`manual` vs `api`) não altera o cálculo; ambos entram na mesma soma.
