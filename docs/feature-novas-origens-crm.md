# Feature: Novas Origens no CRM

**Data:** 2026-04-08
**Branch:** `develop`
**Status:** Implementado — aguardando aplicação da migration no banco de dev

---

## Objetivo

Expandir as origens disponíveis no CRM para refletir todos os canais reais de aquisição de leads do negócio. Antes, o sistema operava com 7 origens ativas na interface (WhatsApp, Meta Ads, Site, Remarketing, Google Ads, Cal.com, Outro) e 2 adicionais apenas no banco (Instagram, Messenger). O objetivo era adicionar as seguintes origens:

- **Instagram** (já existia no banco, faltava na interface)
- **Tiktok**
- **Indicação**
- **Evento**
- **Site** (já existia)
- **Meta Ads** (já existia)
- **Prospecção Ativa**
- **Landing Page**

---

## O que foi realizado

### 1. Migration de banco de dados

Criado o arquivo `supabase/migrations/20260907000000_add_new_lead_origins.sql` que adiciona 5 novos valores ao enum `lead_origin` do PostgreSQL:

```sql
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'tiktok';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'indicacao';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'evento';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'prospeccao_ativa';
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'landing_page';
```

O valor `instagram` já existia no banco desde a migration `20260717000002`. Nenhuma alteração de coluna, constraint ou default foi necessária — o default continua sendo `'outro'`.

### 2. Constantes centrais

Atualizado o arquivo `src/hooks/useMktOriginConfig.ts`, que é a fonte canônica de origens no frontend:

- `ALL_ORIGINS` — array com as 13 origens ativas
- `ORIGIN_LABELS` — mapa slug → label exibido na interface
- `ORIGIN_COLORS` — mapa slug → cor hexadecimal

### 3. Componentes de interface (10 arquivos)

Todas as definições duplicadas de origens foram atualizadas nos seguintes componentes:

| Arquivo | O que contém |
|---|---|
| `src/components/leads/LeadCard.tsx` | `ORIGIN_COLORS` com bg/text/label para badges |
| `src/components/leads/LeadModal.tsx` | `originLabels` no formulário de criação/edição de leads |
| `src/pages/PipeWhatsapp.tsx` | `originLabels` + `ALL_ORIGIN_OPTIONS` para filtros do pipe |
| `src/components/kanban/KanbanCard.tsx` | `originColors` + `originLabels` para cards do kanban |
| `src/components/kanban/CreateOpportunityModal.tsx` | `originLabels` no modal de oportunidade |
| `src/components/confirmacao/ConfirmacaoCard.tsx` | `originConfig` com label/color/icon |
| `src/components/confirmacao/ConfirmacaoFilters.tsx` | Tipo `OriginFilter` + `originOptions` |
| `src/components/analytics/AnalyticsFilters.tsx` | `ORIGINS` no filtro de analytics |
| `src/components/automacoes/sidebar-panels/TriggerPanel.tsx` | `SelectItem`s de origem nas automações |
| `src/components/copilot/wizard-steps/ActivationTriggersStep.tsx` | `ORIGINS` nos triggers do copilot |

### 4. Charts de analytics (3 arquivos)

Atualizados os `ORIGIN_LABELS` duplicados em:

- `src/components/analytics/charts/AttributionTable.tsx`
- `src/components/analytics/charts/LeadQualityByOrigin.tsx`
- `src/components/analytics/charts/ResponseByOrigin.tsx`

### 5. Backend e webhooks (5 arquivos)

| Arquivo | Alteração |
|---|---|
| `supabase/functions/lead-webhook/index.ts` | `originMap` expandido com mapeamentos para as novas origens e aliases (referral → indicacao, event → evento, outbound → prospeccao_ativa, etc.) |
| `supabase/functions/webhook-new-lead/index.ts` | `validOrigins` atualizado |
| `supabase/functions/webhook-confirmacao/index.ts` | `validOrigins` atualizado |
| `supabase/functions/webhook-orchestrator/index.ts` | `validOrigins` atualizado |
| `supabase/functions/_shared/validation.ts` | `validOrigins` atualizado |

**Mudança de comportamento no webhook:** O source `"instagram"` que antes era mapeado para `"meta_ads"` agora é mapeado para `"instagram"` diretamente, refletindo que Instagram é uma origem independente no sistema.

### 6. Tipos TypeScript gerados

Atualizado `src/integrations/supabase/types.ts`:
- Union type `lead_origin` (linha ~8470) — adicionados os 5 novos valores
- Array runtime `lead_origin` (linha ~8667) — adicionados os 5 novos valores

---

## Alterações no banco de dados

### Migration necessária

| Arquivo | Tipo | Descrição |
|---|---|---|
| `supabase/migrations/20260907000000_add_new_lead_origins.sql` | `ALTER TYPE` | Adiciona 5 valores ao enum `lead_origin` |

### Valores do enum `lead_origin` após a migration

| Slug | Label na interface | Status |
|---|---|---|
| `whatsapp` | WhatsApp | Existente |
| `meta_ads` | Meta Ads | Existente |
| `instagram` | Instagram | Existente no banco, adicionado à interface |
| `tiktok` | Tiktok | **Novo** |
| `google_ads` | Google Ads | Existente |
| `site` | Site | Existente |
| `landing_page` | Landing Page | **Novo** |
| `remarketing` | Remarketing | Existente |
| `indicacao` | Indicação | **Novo** |
| `evento` | Evento | **Novo** |
| `prospeccao_ativa` | Prospecção Ativa | **Novo** |
| `cal` | Cal.com | Existente |
| `outro` | Outro | Existente (default) |
| `messenger` | — | Existente no banco, sem exposição na interface |

### Impacto em dados existentes

- **Zero** — nenhum dado existente é alterado
- `ALTER TYPE ADD VALUE IF NOT EXISTS` é uma operação aditiva e segura
- O default da coluna `leads.origin` continua sendo `'outro'`
- Registros antigos permanecem intactos

---

## Próximos passos

1. **Aplicar a migration no banco de dev**
   ```bash
   supabase db push
   ```
   Ou, se usando migrations manuais:
   ```bash
   supabase migration up
   ```

2. **Deploy das edge functions atualizadas**
   As 4 edge functions alteradas (`lead-webhook`, `webhook-new-lead`, `webhook-confirmacao`, `webhook-orchestrator`) e o módulo `_shared/validation.ts` precisam ser redeployados para que o backend aceite as novas origens via webhook.

3. **Testar os fluxos no ambiente de dev**
   - Criar um lead manualmente com cada nova origem no formulário
   - Verificar que a origem aparece corretamente nos cards do kanban, no drawer de detalhes e nas listagens
   - Testar os filtros por origem no pipe de WhatsApp, no pipe de confirmação e nos analytics
   - Enviar um payload de webhook com `source: "tiktok"` (e as demais) e confirmar que o lead é criado com a origem correta
   - Verificar o painel de marketing — as novas origens devem aparecer automaticamente pois usam a constante central `ALL_ORIGINS`

4. **Comunicar a mudança de comportamento do webhook**
   Integrações que enviam `source: "instagram"` via webhook agora terão leads criados com `origin: "instagram"` em vez de `origin: "meta_ads"`. Se houver integrações ativas que dependiam desse mapeamento anterior, avaliar se precisam de ajuste.

5. **Aplicar a migration em produção** (após validação em dev)

---

## Correções do QA

Durante a etapa de Quality Assurance, uma revisão automatizada de código identificou e corrigiu dois bugs críticos que teriam passado para produção. O primeiro era no arquivo `src/integrations/supabase/types.ts`: o union type do `lead_origin` havia sido atualizado corretamente com os 5 novos valores, porém o array runtime do mesmo enum (usado por helpers gerados do Supabase e por validações client-side) não havia sido atualizado, criando uma divergência silenciosa entre o sistema de tipos e a execução real — qualquer código que iterasse esse array em runtime não veria as novas origens. O segundo bug estava em `src/components/confirmacao/ConfirmacaoCard.tsx`: o objeto `originConfig`, responsável por renderizar os badges de origem nos cards do pipe de confirmação, não incluía as 6 novas origens (Instagram, Tiktok, Landing Page, Indicação, Evento, Prospecção Ativa), fazendo com que leads dessas origens fossem silenciosamente exibidos como "Outros" com estilo genérico, mascarando a real procedência do lead. Ambos os bugs foram corrigidos antes da finalização da implementação.
