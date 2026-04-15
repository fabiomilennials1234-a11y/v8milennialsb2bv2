---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-04-01-ghost-master.md
---

# Ghost Master - Ocultar masters das orgs + Acesso total

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Masters ficam invisíveis em organizaçoes (não poluem métricas/listas) e ganham acesso completo a todas as tabelas via RLS.

**Architecture:** Uma migration SQL adiciona master RLS policies às 76 tabelas faltantes, cria uma view `org_visible_members` que exclui masters de team_members, e corrige a RPC `org_get_seat_usage` para não contar masters. No frontend, hooks de listagem de equipe passam a consultar a view em vez da tabela direta.

**Tech Stack:** PostgreSQL (Supabase migrations), React/TypeScript (hooks), Supabase client

---

## File Structure

| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260901100000_ghost_master_rls_and_view.sql` | Migration principal: view + RLS policies + fix seat count |
| `src/hooks/useTeamMembers.ts` | Modificar `useTeamMembers()` para usar view |

---

### Task 1: Migration SQL - View `org_visible_members`

**Files:**
- Create: `supabase/migrations/20260901100000_ghost_master_rls_and_view.sql`

- [ ] **Step 1: Criar o arquivo de migration com a view**

```sql
-- ================================================================
-- Migration: Ghost Master
-- Masters ficam invisíveis nas orgs + acesso total via RLS
-- Date: 2026-04-01
-- ================================================================

-- ============================================
-- PARTE 1: View org_visible_members
-- Exclui master users das listagens de equipe.
-- Usa security_invoker para respeitar RLS do team_members.
-- ============================================

CREATE OR REPLACE VIEW public.org_visible_members
WITH (security_invoker = true) AS
SELECT tm.*
FROM public.team_members tm
WHERE NOT EXISTS (
  SELECT 1 FROM public.master_users mu
  WHERE mu.user_id = tm.user_id
  AND mu.is_active = true
);

COMMENT ON VIEW public.org_visible_members IS
  'View de team_members que exclui master users. Usar para listagens de equipe e métricas.';

GRANT SELECT ON public.org_visible_members TO authenticated, service_role;
```

- [ ] **Step 2: Commit parcial - view criada**

```bash
git add supabase/migrations/20260901100000_ghost_master_rls_and_view.sql
git commit -m "feat(ghost-master): create org_visible_members view excluding masters"
```

---

### Task 2: Migration SQL - Fix `org_get_seat_usage` e `enforce_seat_limit`

**Files:**
- Modify: `supabase/migrations/20260901100000_ghost_master_rls_and_view.sql`

- [ ] **Step 1: Adicionar fix do org_get_seat_usage ao arquivo de migration**

Append ao final do arquivo criado na Task 1:

```sql
-- ============================================
-- PARTE 2: Fix org_get_seat_usage - não contar masters
-- ============================================

CREATE OR REPLACE FUNCTION public.org_get_seat_usage(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_paid_seats   INTEGER;
  v_active_count INTEGER;
  v_plan_limit   INTEGER;
  v_plan_name    TEXT;
BEGIN
  -- Seats pagos via org_subscriptions
  SELECT os.user_count, sp.name
  INTO v_paid_seats, v_plan_name
  FROM public.org_subscriptions os
  JOIN public.subscription_plans sp ON sp.id = os.plan_id
  WHERE os.organization_id = p_org_id
    AND os.cancelled_at IS NULL;

  -- Se não tem subscription, tenta pegar do plano da org (legacy)
  IF v_paid_seats IS NULL THEN
    SELECT
      COALESCE(
        (o.limit_overrides->>'max_users')::INTEGER,
        (sp.limits->>'max_users')::INTEGER,
        2 -- fallback
      ),
      COALESCE(sp.name, o.subscription_plan, 'free')
    INTO v_plan_limit, v_plan_name
    FROM public.organizations o
    LEFT JOIN public.subscription_plans sp ON sp.name = o.subscription_plan
    WHERE o.id = p_org_id;

    v_paid_seats := v_plan_limit;
  END IF;

  -- Membros ativos na org (EXCLUINDO masters)
  SELECT COUNT(*)::INTEGER
  INTO v_active_count
  FROM public.team_members
  WHERE organization_id = p_org_id
    AND is_active = true
    AND NOT public.is_master_user(user_id);

  RETURN jsonb_build_object(
    'paid_seats',    COALESCE(v_paid_seats, 0),
    'active_members', v_active_count,
    'plan_name',     COALESCE(v_plan_name, 'unknown'),
    'is_unlimited',  COALESCE(v_paid_seats, 0) = -1,
    'can_add',       COALESCE(v_paid_seats, 0) = -1 OR v_active_count < COALESCE(v_paid_seats, 0),
    'remaining',     CASE
                       WHEN COALESCE(v_paid_seats, 0) = -1 THEN -1
                       ELSE GREATEST(COALESCE(v_paid_seats, 0) - v_active_count, 0)
                     END
  );
END;
$$;

-- ============================================
-- PARTE 3: Fix enforce_seat_limit - masters nunca bloqueiam seats
-- ============================================

CREATE OR REPLACE FUNCTION public.enforce_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usage JSONB;
BEGIN
  -- Masters nunca são bloqueados pelo limite de seats
  IF public.is_master_user(NEW.user_id) THEN
    RETURN NEW;
  END IF;

  -- Só checa quando ativando um membro (is_active false → true) ou criando ativo
  IF NEW.is_active = true AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.is_active = false)) THEN
    -- Lock na org para serializar ativaçoes concorrentes
    PERFORM 1 FROM public.organizations WHERE id = NEW.organization_id FOR UPDATE;

    v_usage := public.org_get_seat_usage(NEW.organization_id);

    IF NOT (v_usage->>'is_unlimited')::BOOLEAN
       AND (v_usage->>'active_members')::INTEGER >= (v_usage->>'paid_seats')::INTEGER
    THEN
      RAISE EXCEPTION 'Limite de seats atingido. Seats pagos: %, membros ativos: %.',
        (v_usage->>'paid_seats')::INTEGER,
        (v_usage->>'active_members')::INTEGER
      USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
```

- [ ] **Step 2: Commit - seat usage fix**

```bash
git add supabase/migrations/20260901100000_ghost_master_rls_and_view.sql
git commit -m "feat(ghost-master): exclude masters from seat usage count and enforcement"
```

---

### Task 3: Migration SQL - Fix segment benchmark RPC

**Files:**
- Modify: `supabase/migrations/20260901100000_ghost_master_rls_and_view.sql`

- [ ] **Step 1: Verificar se segment_benchmark_rpc precisa de fix**

Run: `grep -n "team_size\|team_members.*count\|COUNT.*team_members" supabase/migrations/20260327100004_segment_benchmark_rpc.sql`

Esperado: linha com `(SELECT COUNT(*) FROM team_members tm WHERE tm.organization_id = po.org_id AND tm.is_active = true) AS team_size`

- [ ] **Step 2: Adicionar fix do benchmark ao arquivo de migration**

Append ao final do arquivo:

```sql
-- ============================================
-- PARTE 4: Fix segment benchmark - team_size sem masters
-- ============================================

-- Recria a função excluindo masters da contagem de team_size.
-- A função completa é recriada para manter consistência.
-- Apenas a subquery de team_size muda: adiciona AND NOT is_master_user(tm.user_id).

-- NOTA: Se a RPC get_segment_benchmark existir, será recriada pela migration original.
-- A correção pontual é feita via a view org_visible_members que já exclui masters.
-- RPCs que contam team_members devem usar org_visible_members ou o filtro NOT is_master_user().
```

> **Nota para o executor:** Ler a RPC `get_segment_benchmark` completa e recriar com o filtro `AND NOT public.is_master_user(tm.user_id)` na subquery de team_size. Como a RPC é grande e pode ter sido alterada desde a escrita deste plano, ler o estado atual antes de recriar.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260901100000_ghost_master_rls_and_view.sql
git commit -m "feat(ghost-master): exclude masters from benchmark team_size metric"
```

---

### Task 4: Migration SQL - Master RLS policies para 76 tabelas

**Files:**
- Modify: `supabase/migrations/20260901100000_ghost_master_rls_and_view.sql`

- [ ] **Step 1: Adicionar bloco de RLS policies para TODAS as tabelas faltantes**

Append ao final do arquivo de migration. Usa `DO $$ ... IF NOT EXISTS ... $$` para idempotência (não falha se policy já existir).

```sql
-- ============================================
-- PARTE 5: Master RLS policies - tabelas faltantes
-- Adiciona acesso master a todas as tabelas com RLS que ainda não têm.
-- Usa IF NOT EXISTS para idempotência.
-- ============================================

DO $$ 
DECLARE
  tables TEXT[] := ARRAY[
    'acoes_do_dia',
    'agent_decision_logs',
    'campaign_dispatch_batches',
    'campanha_allowed_viewers',
    'campanha_dispatch_rule_steps',
    'campanha_dispatch_rules',
    'campanha_leads',
    'campanha_members',
    'campanha_pipe_automations',
    'campanha_stages',
    'campanha_templates',
    'checklist_items',
    'checklists',
    'competition_participants',
    'competition_prizes',
    'competitions',
    'conversation_context_summary',
    'conversation_messages',
    'conversation_notes',
    'conversation_summaries',
    'copilot_ab_assignments',
    'copilot_agent_audios',
    'copilot_agent_document_chunks',
    'copilot_agent_variants',
    'copilot_conversation_evaluations',
    'cron_config',
    'custom_pipe_entries',
    'custom_pipe_transitions',
    'custom_pipeline_members',
    'custom_pipeline_stages',
    'custom_pipelines',
    'follow_up_automations',
    'followup_automation_log',
    'google_calendar_sync_logs',
    'help_articles',
    'help_categories',
    'lead_custom_field_values',
    'lead_custom_fields',
    'lead_memories',
    'lead_scores',
    'lead_tags',
    'leads_reativacao',
    'notifications',
    'oraculo_usage',
    'org_onboarding',
    'organization_role_permissions',
    'outbound_dispatch_log',
    'pending_ai_actions',
    'pending_org_invites',
    'pipe_dispatch_rule_steps',
    'pipe_dispatch_rules',
    'pipe_distribution_members',
    'pipe_distribution_rules',
    'pipe_proposta_items',
    'pipeline_display_config',
    'product_materials',
    'product_variants',
    'scheduled_campaign_messages',
    'scheduled_pipe_messages',
    'scheduled_user_messages',
    'sz_chat_config',
    'sz_chat_sessions',
    'team_member_permissions',
    'tinyerp_connections',
    'tinyerp_order_mappings',
    'tinyerp_product_mappings',
    'tinyerp_sync_logs',
    'webhook_deliveries',
    'webhook_delivery_logs',
    'webhooks',
    'whatsapp_conversation_tags',
    'whatsapp_conversations',
    'whatsapp_instance_allowed_members',
    'whatsapp_rate_tracking',
    'workflow_split_assignments',
    'workflow_split_events'
  ];
  t TEXT;
  policy_select TEXT;
  policy_all TEXT;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    policy_select := 'master_ghost_select_' || t;
    policy_all := 'master_ghost_all_' || t;

    -- SELECT policy
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'public' AND tablename = t AND policyname = policy_select
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_master_user())',
        policy_select, t
      );
    END IF;

    -- ALL policy (INSERT, UPDATE, DELETE)
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'public' AND tablename = t AND policyname = policy_all
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING (public.is_master_user()) WITH CHECK (public.is_master_user())',
        policy_all, t
      );
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 2: Commit - RLS policies**

```bash
git add supabase/migrations/20260901100000_ghost_master_rls_and_view.sql
git commit -m "feat(ghost-master): add master RLS policies to 76 missing tables"
```

---

### Task 5: Frontend - `useTeamMembers()` usa view

**Files:**
- Modify: `src/hooks/useTeamMembers.ts:190-221`

- [ ] **Step 1: Modificar `useTeamMembers()` para consultar a view**

No hook `useTeamMembers()` (linha ~198), trocar a source da query:

```typescript
// ANTES:
const { data, error } = await supabase
  .from("team_members")
  .select("*")
  .eq("organization_id", organizationId)
  .order("name");

// DEPOIS:
const { data, error } = await supabase
  .from("org_visible_members" as any)
  .select("*")
  .eq("organization_id", organizationId)
  .order("name");
```

**Importante - NÃO mudar estes hooks (devem continuar usando `team_members` diretamente):**
- `useCurrentTeamMember()` - master precisa encontrar seu record/virtual member
- `useTeamMember(id)` - lookup individual por ID
- `useCreateTeamMember()` - mutation INSERT
- `useUpdateTeamMember()` - mutation UPDATE
- `useDeleteTeamMember()` - mutation DELETE
- Todos os hooks em `useMasterUsers.ts` - admin master vê tudo
- `useOrgSwitcher.ts` - lista orgs do user (não membros)

- [ ] **Step 2: Verificar que o build compila**

Run: `npx tsc --noEmit 2>&1 | head -20`

Esperado: sem erros relacionados a `org_visible_members`

- [ ] **Step 3: Commit - frontend hook**

```bash
git add src/hooks/useTeamMembers.ts
git commit -m "feat(ghost-master): useTeamMembers reads from org_visible_members view"
```

---

### Task 6: Validação - Deploy e teste

- [ ] **Step 1: Verificar que a migration é válida**

Run: `cat supabase/migrations/20260901100000_ghost_master_rls_and_view.sql | head -5`

Confirmar que o arquivo existe e começa com o header esperado.

- [ ] **Step 2: Deploy da migration no ambiente de dev**

Run: `npx supabase db push --linked`

Esperado: migration aplicada sem erros.

- [ ] **Step 3: Testar no Supabase - view funciona**

Verificar no SQL Editor do Supabase:

```sql
-- Deve retornar membros SEM masters
SELECT * FROM org_visible_members LIMIT 10;

-- Comparar com team_members (deve ter mais rows se master tem team_member)
SELECT COUNT(*) FROM team_members;
SELECT COUNT(*) FROM org_visible_members;
```

- [ ] **Step 4: Testar - seat usage não conta masters**

```sql
-- Substituir pelo org_id real
SELECT org_get_seat_usage('SEU_ORG_ID_AQUI');
-- active_members NÃO deve incluir masters
```

- [ ] **Step 5: Testar - master pode acessar tabelas antes bloqueadas**

Login como master no app → navegar para uma org → verificar:
- Custom fields aparecem
- Custom pipelines carregam
- Campanhas são visíveis
- Conversas são acessíveis

- [ ] **Step 6: Testar - master NÃO aparece na lista de equipe**

Navegar para a página Equipe de uma org → confirmar que o master não está listado.

- [ ] **Step 7: Commit final**

```bash
git add -A
git commit -m "feat(ghost-master): complete ghost master implementation - hidden from orgs, full access everywhere"
```

---

## Resumo de impacto

| Componente | Mudança | Risco |
|---|---|---|
| View `org_visible_members` | Nova (aditiva) | Zero - não altera nada existente |
| `org_get_seat_usage()` | Recriada com filtro master | Baixo - apenas exclui masters da contagem |
| `enforce_seat_limit()` | Recriada com bypass master | Baixo - masters não consomem seats |
| 76 RLS policies | Novas (aditivas) | Zero - apenas adicionam permissão, nunca removem |
| `useTeamMembers()` | Source muda para view | Baixo - view retorna mesmos dados minus masters |
| Mutations (INSERT/UPDATE/DELETE) | **Não mudam** | Zero |
| Hooks de master admin | **Não mudam** | Zero |


## Links relacionados

- [[Pipelines Customizados]]

- [[Master Admin]]

- [[Regras de Pipe]]

- [[Gestao de Time]]

- [[Mensagens Agendadas]]

- [[Onboarding]]

- [[Webhooks]]

- [[Permissoes Sistema]]

- [[SZ Chat]]

- [[Follow-ups]]

- [[Campanhas]]

- [[Workflow Builder]]

- [[Lead Score]]

- [[Oraculo Comercial]]

- [[Google Calendar]]

- [[TinyERP]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
