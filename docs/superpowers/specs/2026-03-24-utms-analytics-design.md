# UTMs Analytics Tab — Design Spec

**Date:** 2026-03-24
**Status:** Approved

## Overview

Nova aba "UTMs" dentro da página de Analytics que permite visualizar leads do Meta Ads com drill-down por Campanha → Conjunto de Ads → Anúncio → Leads individuais. Inclui cruzamento de dados internos (leads no Supabase) com métricas da API do Meta Ads (spend, impressions, clicks). Inicialmente exclusivo para a organização Milennials.

## Decisões de Design

- **Navegação:** Breadcrumb drill-down (não expand/collapse nem master-detail)
- **KPIs:** Misto — Total de Leads, Total Investido, CPL, Taxa de Conversão, ROAS, CAC
- **Meta API auth:** Token via `.env` (`META_ADS_ACCESS_TOKEN` + `META_ADS_ACCOUNT_ID`)
- **Edge Function:** Sem validação de JWT
- **Webhook:** Enriquecimento automático de UTMs somente para org Milennials, com fallback seguro
- **Lead detail:** Nome, email, telefone, data, status, responsável, rating + link para CRM
- **Arquitetura:** RPC no Postgres (leads) + Edge Function (Meta API) + cruzamento no client

## Arquitetura

### Abordagem

- RPC function no Postgres agrupa leads por UTMs (rápido, com índices)
- Edge Function separada busca métricas do Meta Ads API por campanha/adset/ad
- Frontend cruza os dois no client via React Query
- Segue o padrão das outras tabs de Analytics

### Estrutura de Arquivos

```
src/components/analytics/tabs/UtmsTab.tsx           — Container da tab
src/components/analytics/charts/UtmBreadcrumb.tsx   — Breadcrumb de navegação
src/components/analytics/charts/UtmKpiCards.tsx      — 6 KPI cards do topo
src/components/analytics/charts/UtmCampaignTable.tsx — Tabela nível campanha
src/components/analytics/charts/UtmAdsetTable.tsx    — Tabela nível conjunto
src/components/analytics/charts/UtmAdTable.tsx       — Tabela nível anúncio
src/components/analytics/charts/UtmLeadsList.tsx     — Lista de leads individual
src/hooks/useUtmAnalytics.ts                         — Hook React Query
supabase/functions/meta-ads-insights/index.ts        — Edge Function Meta API
supabase/migrations/XXXX_analytics_utm_rpc.sql       — RPC function
```

## Componentes

### 1. RPC Function — `get_analytics_utm_metrics`

**Parâmetros:**
- `p_org_id` UUID
- `p_start_date` DATE
- `p_end_date` DATE
- `p_level` TEXT — `'campaign'` | `'adset'` | `'ad'` | `'leads'`
- `p_campaign` TEXT (nullable) — filtra por utm_campaign
- `p_adset` TEXT (nullable) — filtra por utm_content

**Retorno para `campaign`, `adset`, `ad`:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| name | TEXT | utm_campaign, utm_content, ou utm_term |
| total_leads | INTEGER | Contagem de leads |
| converted | INTEGER | Leads em stage de ganho/venda |
| conversion_rate | NUMERIC | converted / total_leads |
| avg_rating | NUMERIC | Média do rating dos leads |

**Retorno para `leads`:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | ID do lead |
| name | TEXT | Nome do lead |
| email | TEXT | Email |
| phone | TEXT | Telefone |
| created_at | TIMESTAMPTZ | Data de entrada |
| pipe_status | TEXT | Stage atual no pipe |
| responsible | TEXT | Nome do responsável |
| rating | INTEGER | Rating do lead |

**Filtros sempre aplicados:**
- `organization_id = p_org_id`
- `origin = 'meta_ads'`
- `created_at BETWEEN p_start_date AND p_end_date`
- `utm_campaign IS NOT NULL`

### 2. Edge Function — `meta-ads-insights`

**Endpoint:** POST `/functions/v1/meta-ads-insights`

**Sem validação de JWT.**

**Request body:**
```json
{
  "start_date": "2026-01-01",
  "end_date": "2026-01-31",
  "level": "campaign | adset | ad",
  "campaign_id": null,
  "adset_id": null
}
```

**Chamadas à Graph API:**

Nível `campaign`:
```
GET /v19.0/{ACCOUNT_ID}/insights
  ?level=campaign
  &fields=campaign_id,campaign_name,spend,impressions,clicks,cpc,ctr,actions,action_values
  &time_range={"since":"...","until":"..."}
  &limit=100
```

Nível `adset`:
```
GET /v19.0/{ACCOUNT_ID}/insights
  ?level=adset
  &fields=adset_id,adset_name,spend,impressions,clicks,cpc,ctr,actions,action_values
  &filtering=[{"field":"campaign.id","operator":"EQUAL","value":"{campaign_id}"}]
  &time_range=...
```

Nível `ad`:
```
GET /v19.0/{ACCOUNT_ID}/insights
  ?level=ad
  &fields=ad_id,ad_name,spend,impressions,clicks,cpc,ctr,actions,action_values
  &filtering=[{"field":"adset.id","operator":"EQUAL","value":"{adset_id}"}]
  &time_range=...
```

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

**Autenticação:** Lê `META_ADS_ACCESS_TOKEN` e `META_ADS_ACCOUNT_ID` do environment.

### 3. Hook — `useUtmAnalytics`

**Assinatura:** `useUtmAnalytics(level, campaign?, adset?)`

Faz duas queries em paralelo:
1. RPC `get_analytics_utm_metrics` → leads agrupados
2. Edge Function `meta-ads-insights` → métricas Meta

**Cruzamento por nome:**
- Meta `campaign_name` ↔ RPC `utm_campaign`
- Meta `adset_name` ↔ RPC `utm_content`
- Meta `ad_name` ↔ RPC `utm_term`

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

**Chamada à Graph API:**
```
GET /v19.0/{ad_id}
  ?fields=name,adset{id,name},campaign{id,name}
  &access_token={META_ADS_ACCESS_TOKEN}
```

**Mapeamento:**
- `campaign.name` → `utm_campaign`
- `adset.name` → `utm_content`
- `ad.name` → `utm_term`
- `utm_source` → `"facebook"` (fixo)
- `utm_medium` → `"paid"` (fixo)

**Fallback:** Se a Graph API falhar, o lead é criado normalmente sem UTMs.

### 5. UI — Componentes

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

**Filtros:** Usa `AnalyticsFilters` existentes (date range). Origin fixo em `meta_ads`.

## Navegação

Nova tab "UTMs" adicionada em `Analytics.tsx` como 6ª tab, após "Engajamento".

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
- Edge Function: sem JWT, usa token do .env
- Qualquer falha na integração Meta não impede funcionamento existente
