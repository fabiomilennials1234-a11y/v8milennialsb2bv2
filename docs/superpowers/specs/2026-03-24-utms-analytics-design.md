# UTMs Analytics Tab — Design Spec

**Date:** 2026-03-24
**Status:** Approved

## Overview

Nova aba "UTMs" dentro da página de Analytics que permite visualizar leads do Meta Ads com drill-down por Campanha → Conjunto de Ads → Anúncio → Leads individuais. Inclui cruzamento de dados internos (leads no Supabase) com métricas da API do Meta Ads (spend, impressions, clicks). Inicialmente exclusivo para a organização Milennials.

## Decisões de Design

- **Navegação:** Breadcrumb drill-down (não expand/collapse nem master-detail)
- **KPIs:** Misto — Total de Leads, Total Investido, CPL, Taxa de Conversão, ROAS, CAC
- **Meta API auth:** Token via `.env` (`META_ADS_ACCESS_TOKEN` + `META_ADS_ACCOUNT_ID`)
- **Meta API version:** Usar `v21.0` (consistente com `_shared/meta-api.ts`)
- **Edge Function:** Usa `Authorization: Bearer <anon-key>` para validar chamadas (sem JWT completo, mas não aberta)
- **Webhook:** Enriquecimento automático de UTMs somente para org Milennials, com fallback seguro
- **Lead detail:** Nome, email, telefone, data, status, responsável, rating + link para CRM
- **Arquitetura:** RPC no Postgres (leads) + Edge Function (Meta API) + cruzamento no client
- **Matching:** Por ID (campaign_id, adset_id, ad_id) — não por nome, para evitar problemas com renomeações
- **Tab gating:** Aba visível somente para org Milennials (verificação por org_id)

## Arquitetura

### Abordagem

- RPC function no Postgres agrupa leads por UTMs (rápido, com índices)
- Edge Function separada busca métricas do Meta Ads API por campanha/adset/ad
- Frontend cruza os dois no client via React Query
- Segue o padrão das outras tabs de Analytics

### Estrutura de Arquivos

```
src/components/analytics/tabs/UtmsTab.tsx           — Container da tab (com AnalyticsErrorBoundary)
src/components/analytics/charts/UtmBreadcrumb.tsx   — Breadcrumb de navegação
src/components/analytics/charts/UtmKpiCards.tsx      — 6 KPI cards do topo
src/components/analytics/charts/UtmCampaignTable.tsx — Tabela nível campanha
src/components/analytics/charts/UtmAdsetTable.tsx    — Tabela nível conjunto
src/components/analytics/charts/UtmAdTable.tsx       — Tabela nível anúncio
src/components/analytics/charts/UtmLeadsList.tsx     — Lista de leads individual
src/hooks/useAnalyticsUtms.ts                        — Hook React Query (padrão useAnalytics{Tab})
supabase/functions/meta-ads-insights/index.ts        — Edge Function Meta API
supabase/migrations/XXXX_analytics_utm_rpc.sql       — RPC function + índices
```

## Componentes

### 1. RPC Function — `get_analytics_utm_metrics`

**Retorna JSONB** (consistente com RPCs existentes como `get_analytics_engagement_metrics`).

**Parâmetros:**
- `p_org_id` UUID
- `p_start_date` DATE
- `p_end_date` DATE
- `p_member_id` UUID DEFAULT NULL — filtra por responsible_id (consistente com filtros globais)
- `p_level` TEXT — `'campaign'` | `'adset'` | `'ad'` | `'leads'`
- `p_campaign` TEXT (nullable) — filtra por utm_campaign
- `p_adset` TEXT (nullable) — filtra por utm_content

**Retorno JSONB com shape dependendo do level:**

Para `campaign`, `adset`, `ad`:
```json
{
  "items": [
    {
      "name": "Nome da Campanha",
      "total_leads": 42,
      "converted": 8,
      "conversion_rate": 19.04,
      "avg_rating": 3.5,
      "revenue": 15000.00
    }
  ]
}
```

Para `leads`:
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Nome do Lead",
      "email": "email@example.com",
      "phone": "+5511999999999",
      "created_at": "2026-01-15T10:30:00Z",
      "pipe_status": "qualificado",
      "responsible": "Nome do Responsável",
      "rating": 4
    }
  ]
}
```

**Filtros sempre aplicados:**
- `organization_id = p_org_id`
- `origin = 'meta_ads'`
- `created_at BETWEEN p_start_date AND p_end_date`
- `utm_campaign IS NOT NULL`
- `responsible_id = p_member_id` (quando não NULL)

**Revenue:** JOIN com pipe de propostas para somar `sale_value` de leads com status "vendido"/"ganho".

**Índice na migração:**
```sql
CREATE INDEX IF NOT EXISTS idx_leads_org_origin_utm
  ON leads(organization_id, created_at)
  WHERE origin = 'meta_ads' AND utm_campaign IS NOT NULL;
```

### 2. Edge Function — `meta-ads-insights`

**Endpoint:** POST `/functions/v1/meta-ads-insights`

**Autenticação:** Valida `Authorization: Bearer <supabase-anon-key>` no header. Não requer JWT de usuário, mas rejeita requests sem a anon key.

**Request body:**
```json
{
  "start_date": "2026-01-01",
  "end_date": "2026-01-31",
  "level": "campaign | adset | ad",
  "campaign_id": null,
  "adset_id": null,
  "org_id": "uuid"
}
```

**Usa shared helpers:** `getCorsHeaders()`, `withSecurityHeaders()`, `withSentry()`, `logger` — consistente com outras Edge Functions.

**Usa `GRAPH_API_VERSION` de `_shared/meta-api.ts` (v21.0).**

**Chamadas à Graph API:**

Nível `campaign`:
```
GET /v21.0/{ACCOUNT_ID}/insights
  ?level=campaign
  &fields=campaign_id,campaign_name,spend,impressions,clicks,cpc,ctr,actions,action_values
  &time_range={"since":"...","until":"..."}
  &limit=100
```

Nível `adset`:
```
GET /v21.0/{ACCOUNT_ID}/insights
  ?level=adset
  &fields=adset_id,adset_name,spend,impressions,clicks,cpc,ctr,actions,action_values
  &filtering=[{"field":"campaign.id","operator":"EQUAL","value":"{campaign_id}"}]
  &time_range=...
```

Nível `ad`:
```
GET /v21.0/{ACCOUNT_ID}/insights
  ?level=ad
  &fields=ad_id,ad_name,spend,impressions,clicks,cpc,ctr,actions,action_values
  &filtering=[{"field":"adset.id","operator":"EQUAL","value":"{adset_id}"}]
  &time_range=...
```

**Paginação:** Segue `paging.next` se presente (padrão de `listPages` em `_shared/meta-api.ts`).

**Retorno normalizado:**
```json
[{
  "id": "campaign_id/adset_id/ad_id",
  "name": "nome",
  "spend": 1500.00,
  "impressions": 50000,
  "clicks": 1200,
  "cpc": 1.25,
  "ctr": 2.4
}]
```

**Autenticação Meta:** Lê `META_ADS_ACCESS_TOKEN` e `META_ADS_ACCOUNT_ID` do environment.

### 3. Hook — `useAnalyticsUtms`

**Assinatura:** `useAnalyticsUtms(level, campaign?, adset?)`

Usa internamente `useOrganization()` e `useAnalyticsFilters()` (consistente com outros hooks). Os parâmetros `level`, `campaign`, `adset` são o estado de drill-down gerenciado pelo `UtmsTab`.

Faz duas queries em paralelo:
1. RPC `get_analytics_utm_metrics` → leads agrupados
2. Edge Function `meta-ads-insights` → métricas Meta

**Cruzamento por ID:**
- Webhook salva `meta_campaign_id`, `meta_adset_id`, `meta_ad_id` no lead (campos novos, ver seção 4)
- RPC agrupa e retorna esses IDs junto com os nomes
- Match com dados do Meta API por ID (campaign_id, adset_id, ad_id)

**Dados combinados por linha:**
```typescript
{
  id: string,
  name: string,
  spend: number,
  impressions: number,
  clicks: number,
  ctr: number,
  cpc: number,
  totalLeads: number,
  converted: number,
  conversionRate: number,
  cpl: number,          // spend / totalLeads
  cac: number,          // spend / converted
  roas: number,         // revenue / spend
}
```

**Quando `level = 'leads'`**: só chama o RPC.

### 4. Webhook — Enriquecimento automático de UTMs

**Localização:** `supabase/functions/meta-webhook/index.ts`

**Regras de segurança:**
1. **Condicional por org** — Só executa para a organização Milennials (verificação por org_id)
2. **Try/catch isolado** — Chamada à Graph API em try/catch separado; falha nunca bloqueia criação do lead
3. **Não sobrescreve** — Se UTMs já vierem preenchidas (via field_mapping), não toca
4. **Zero alteração no fluxo existente** — Para qualquer outra org, webhook funciona exatamente como hoje

**Duas chamadas à Graph API (leadgen não tem ad_id diretamente):**

Passo 1 — Buscar ad_id do leadgen:
```
GET /v21.0/{leadgen_id}
  ?fields=ad_id
  &access_token={META_ADS_ACCESS_TOKEN}
```

Passo 2 — Buscar hierarquia do ad:
```
GET /v21.0/{ad_id}
  ?fields=name,adset{id,name},campaign{id,name}
  &access_token={META_ADS_ACCESS_TOKEN}
```

**Campos salvos no lead:**
- `utm_campaign` → `campaign.name`
- `utm_content` → `adset.name`
- `utm_term` → `ad.name`
- `utm_source` → `"facebook"` (fixo)
- `utm_medium` → `"paid"` (fixo)

**Campos de ID adicionais (novos na tabela leads):**
- `meta_campaign_id` → `campaign.id`
- `meta_adset_id` → `adset.id`
- `meta_ad_id` → `ad.id`

Estes campos são usados para matching por ID no hook (seção 3).

**Nota sobre mapeamento UTM:** O uso de `utm_content` para adset e `utm_term` para ad é uma convenção interna deste projeto, não o padrão UTM universal. Documentado aqui para referência futura.

**Fallback:** Se qualquer chamada à Graph API falhar, o lead é criado normalmente sem UTMs.

**Migração necessária:** Adicionar colunas `meta_campaign_id`, `meta_adset_id`, `meta_ad_id` (TEXT, nullable) à tabela `leads`.

### 5. UI — Componentes

**Todos os sub-componentes dentro de `UtmsTab` devem ser wrappados em `<AnalyticsErrorBoundary>`** (padrão das outras tabs).

**UtmKpiCards (6 cards):**
- Total de Leads | Total Investido (R$) | CPL (R$) | Taxa de Conversão (%) | ROAS | CAC (R$)
- Mesmo estilo visual dos KPI cards das outras tabs

**Tabelas (Campanha/Conjunto/Anúncio):**

| Nome | Investimento | Impressões | Cliques | CTR | CPC | Leads | Conversão | CPL | CAC |

- Ordenável por qualquer coluna (toggle asc/desc)
- Linha clicável para drill-down
- Cores: CPL/CAC com verde (bom), amarelo (médio), vermelho (alto)

**UtmLeadsList (nível final):**

| Nome | Email | Telefone | Data de Entrada | Status no Pipe | Responsável | Rating |

- Nome clicável abre `LeadDetailDrawer` existente
- Rating com estrelas (componente existente)

**UtmBreadcrumb:**
- `Campanhas > {nome} > {nome} > {nome}`
- Cada nível clicável para voltar

**Filtros:** Usa `AnalyticsFilters` existentes (date range + member). Origin fixo em `meta_ads`.

## Navegação

Nova tab "UTMs" adicionada em `Analytics.tsx` como 6ª tab, após "Engajamento".

**Gating:** Tab visível somente para org Milennials. Verificação por org_id no componente `Analytics.tsx` — se não for Milennials, a tab não é renderizada.

Fluxo:
```
[UTMs Tab]
  → Tabela de Campanhas (utm_campaign)
    → Click → Tabela de Conjuntos (utm_content)
      → Click → Tabela de Anúncios (utm_term)
        → Click → Lista de Leads com link pro CRM
```

## Escopo de Segurança

- Webhook: mudança SOMENTE para org Milennials, isolada em try/catch
- Edge Function: valida anon-key, usa token do .env
- Qualquer falha na integração Meta não impede funcionamento existente
- Novos campos (meta_*_id) são nullable, não afetam leads existentes
