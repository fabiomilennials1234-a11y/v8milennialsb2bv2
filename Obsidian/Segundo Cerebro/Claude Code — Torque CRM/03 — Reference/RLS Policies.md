---
type: reference
title: RLS Policies
status: draft
created: 2026-05-15
updated: 2026-06-30
tags: [reference, rls, security, multi-tenant]
related: ["[[Multi-tenancy]]", "[[Schema]]", "[[Areas Frageis]]"]
owner: gabriel
---

# RLS Policies — Reference

> Para entender o **modelo** de multi-tenancy, ver [[Multi-tenancy]].
> Este doc lista policies-chave por tabela (stub — preencher iterativamente).

## Padrão geral

Toda tabela com `organization_id` segue o template:

```sql
CREATE POLICY "tenant_isolation_select" ON <table>
  FOR SELECT
  USING (organization_id = auth.org_id());

CREATE POLICY "tenant_isolation_all" ON <table>
  FOR ALL
  USING (organization_id = auth.org_id())
  WITH CHECK (organization_id = auth.org_id());
```

## Helper SQL

```sql
auth.org_id()       -- extrai organization_id do JWT custom claims
auth.uid()          -- user id (Supabase Auth)
auth.is_master()    -- true se role master (cross-org)
```

> **Nomes reais em prod (confirmados via migrations recentes).** As policies
> vivas usam helpers `SECURITY DEFINER` no schema `public`, não os apelidos
> `auth.*` acima. Ao escrever policy nova, usar:
> - `public.get_user_organization_id()` — org_id do caller (substitui `auth.org_id()`).
> - `public.is_master_user()` — forma zero-arg = `auth.uid()`; `SECURITY DEFINER STABLE`.
> - `public.is_user_admin()` — admin da própria org.
> - `public.get_my_organization_ids()` / `get_my_admin_organization_ids()` /
>   `get_my_team_member_ids()` — listas `SECURITY DEFINER` que **bypassam RLS** e
>   evitam a recursão de `apply_rls()` no Realtime (ver Gotchas + [[Areas Frageis]]).

## Casos especiais

### Deny-all (service_role bypass apenas)

`whatsapp_instance_secrets`:
```sql
CREATE POLICY "deny_all" ON whatsapp_instance_secrets FOR ALL USING (false);
```

Acesso só via RPC `SECURITY DEFINER` (`get_uazapi_credentials`, `set_uazapi_credentials`).

### Master cross-org

`master_audit_log`, `subscription_plans`:
```sql
CREATE POLICY "master_only_select" ON <table>
  FOR SELECT USING (auth.is_master());
```

### Master ghost (acesso total cross-org, invisível)

Padrão "ghost master": o master é membro de nenhuma org (ou só de algumas), mas
precisa de acesso **total** a tabelas operacionais de qualquer org — sem aparecer
como `team_member`. Cada tabela operacional ganha **duas** policies permissivas
(combinam por OR com as policies org-member, que continuam intactas):

```sql
-- por tabela:
CREATE POLICY "master_ghost_select_<tbl>" ON public.<tbl>
  FOR SELECT USING (public.is_master_user());

CREATE POLICY "master_ghost_all_<tbl>" ON public.<tbl>
  FOR ALL USING (public.is_master_user()) WITH CHECK (public.is_master_user());
```

`is_master_user()` é `SECURITY DEFINER STABLE` (forma zero-arg = `auth.uid()`).
Não usa subquery inline em `team_members` → não dispara a recursão de
`apply_rls()` no Realtime. Aplicado em massa em
`20260901200000_ghost_master_rls_and_view.sql` (parte 5) para ~50 tabelas
operacionais (`acoes_do_dia`, `custom_pipe_entries`, `leads`, `pipeline_entries`,
`workflows`, …).

#### `checklists` / `checklist_items`
- Org-member: `Checklists visible to org members` (SELECT) + `Org members can {insert,update,delete} checklists` (e equivalentes em `checklist_items` via `checklist_id`), todas via `get_my_organization_ids()` — `20261031000008_fix_checklist_rls_use_helpers.sql`.
- Master ghost: `master_ghost_select_<tbl>` + `master_ghost_all_<tbl>` em ambas as tabelas — `20261118000000_master_ghost_rls_checklists.sql`.
- **Gap corrigido (2026-06-02)**: essas duas tabelas estavam SEM as policies `master_ghost_*` (presentes nas irmãs). Master que não é `team_member` da org-alvo não conseguia INSERT (`new row violates row-level security policy`). Migration de fix replica o idioma das irmãs 1:1.

### Soft RLS (org_id NULL aceito)

Algumas tabelas de lookup global têm policy permissiva:
```sql
CREATE POLICY "public_read_lookup" ON <table>
  FOR SELECT USING (true);
```

## Padrões recentes (confirmados via migrations)

Padrões abaixo verificados lendo a migration citada no repo (não inferidos).
Cada um vale como referência de idioma para policies/RPCs novas.

### 1. torque-mcp — role read-only contida (`mcp_readonly`)

`20261226000000_torque_mcp_readonly_role.sql` (PR #864, `ba8d6cdd`).
Padrão de **contenção física por role**, não só validação no app, para a tool
`db.read_sql` do [[Torque MCP|torque-mcp]]:

- Cria `CREATE ROLE mcp_readonly NOLOGIN BYPASSRLS` com `GRANT SELECT ON ALL
  TABLES IN SCHEMA public` (+ default privileges). `BYPASSRLS` é **intencional**:
  é ferramenta de ops cross-org.
- **Parede dura**: `REVOKE SELECT` em toda tabela cujo nome casa
  `~* '(secret|credential|token|password)'` (loop self-maintaining) + revoke
  explícito em `whatsapp_instance_secrets` e `google_calendar_tokens`. O role
  fisicamente não lê segredos, mesmo com BYPASSRLS.
- RPC `public.mcp_exec_readonly_sql(text, integer)` `SECURITY DEFINER`, **OWNER =
  `mcp_readonly`** (corpo roda como o role — PG proíbe `SET ROLE` dentro de
  definer). Camadas: master-only (`is_master_user()`), parse guard (single
  statement, `^(select|with)\s`), `SET LOCAL TRANSACTION READ ONLY`,
  `statement_timeout = 5000`. `GRANT EXECUTE ... TO authenticated, service_role`.

### 2. RPC privilegiada gateada a `service_role` (cron.toggle)

`20261223000000_torque_mcp_s2_policies.sql` (PR #859, `2536caed`).
pg_cron é privilegiado (schema `cron`, sem RLS) → encapsular o flip do flag
`active` numa RPC `SECURITY DEFINER` exposta **só** a service_role:

```sql
public.toggle_cron_job(p_jobname text, p_enabled boolean)  -- SECURITY DEFINER
-- REVOKE ALL FROM public, anon, authenticated;
-- GRANT EXECUTE TO service_role;
-- usa cron.alter_job(jobid, active := ...); nunca deleta job.
```

Nota da própria migration: `copilot.update_prompt` **não** precisou de policy
nova — `copilot_agents` já tem `master_all_copilot_agents FOR ALL USING
(is_master_user())` (`20260131200001`), que cobre o UPDATE do master.

### 3. Trigger das views `pipe_*` como `SECURITY INVOKER` (ghost-stage guard)

`20261220000000_ghost_stage_guard_pipe_insert.sql` (PR #831, `33fe65bc`).
Helper `public.fn_resolve_active_stage_key(p_org_id, p_pipeline_type,
p_requested, p_static_fallback)` `STABLE SECURITY INVOKER`, `SET search_path =
public, pg_temp`. Coage o `stage_key` para uma etapa **ativa** da org
(1: requested se ativo; 2: 1ª ativa por `position`; 3: fallback estático). É
chamado dentro das INSTEAD OF INSERT fns `pipe_whatsapp_insert_fn` /
`pipe_confirmacao_insert_fn` / `pipe_propostas_insert_fn`.

Padrão RLS-adjacent: as trigger fns das views compat são **`SECURITY INVOKER`** —
herdam o contexto/RLS do caller (preservam RLS de `pipeline_stages` da própria
org), não escalam. UPDATE/DELETE não mudam (move explícito de stage é
intencional, fora do escopo do guard).

### 4. Gotcha: policy via FK opcional é NULL-blind (`goals`)

`20261225000000_fix_goals_rls_team_null_blind.sql` (PR #863, `36123faf`).
Policies antigas gateavam via `EXISTS (SELECT 1 FROM team_members WHERE
team_members.id = goals.team_member_id ...)`. Quando `team_member_id IS NULL`
(meta do time, default na UI Gestão de Metas), `id = NULL` → **NULL** → nunca
TRUE → INSERT rejeitado **e** SELECT invisível para todo role (admin, membro,
master). Metas individuais funcionavam, o que fazia o bug parecer parcial.

Fix — gatear direto na coluna da própria tabela, NULL-safe, com branch master:
```sql
CREATE POLICY goals_select_org ON public.goals
  FOR SELECT TO authenticated
  USING (public.is_master_user()
         OR organization_id = public.get_user_organization_id());

CREATE POLICY goals_manage_admin_org ON public.goals
  FOR ALL TO authenticated
  USING (public.is_master_user()
         OR (public.is_user_admin() AND organization_id = public.get_user_organization_id()))
  WITH CHECK (...mesmo predicado...);
```
**Regra**: `x = NULL` em SQL é NULL, nunca TRUE. Quando a tabela tem
`organization_id`, gatear por ela — não por FK que pode ser NULL.

### 5. `service_role` precisa de `TO service_role` + `is_team_member()` não isola tenant

`20261218000000_fix_rls_service_role_and_api_key_auth.sql` +
`20261218000002_security_fix_remaining_is_team_member_policies.sql`
(re-timestamp via PR #824, `4a216c5f` — eram 2 dos 5 críticos pulados por colisão
de versão).

- **W0-1** (`...000000`): policies "service role" criadas **sem** a clause
  `TO service_role`, com `USING (true) WITH CHECK (true)`, valem para **todos** os
  roles (anon, authenticated, service_role) → qualquer user tinha
  read/write/delete cross-tenant. Recriadas com `FOR ALL TO service_role` em 8
  tabelas: `agent_decision_logs`, `conversation_summaries`,
  `webhook_dead_letters`, `outbound_dispatch_log`, `system_alerts`, `audit_log`,
  `workflow_executions`, `workflow_execution_steps`.
- **W0-5** (`...000000`): `generate_api_key()` (`SECURITY DEFINER`) fazia zero
  authorization → qualquer authenticated mintava API key para qualquer org.
  Ganhou check `is_master_user()` OR (`team_members.role = 'admin'` na org-alvo).
- **`...000002`**: 7 tabelas ainda gateavam por `is_team_member()` **sem filtro
  de org** → leitura/escrita cross-org. Substituídas por policies org-scoped
  (`organization_id = public.get_user_organization_id()`, ou `EXISTS` via FK para
  `leads`/`team_members` da org): `lead_scores`, `pipe_proposta_items`,
  `follow_up_automations`, `goals`, `awards`, `leads_reativacao`,
  `product_variants` (+ `lead_history` insert, `commissions`, e drops de policies
  legacy permissivas em `profiles`/`leads`/`lead_history`).

**Regras**: (a) toda policy de service_role **exige** `TO service_role` explícito
— sem isso aplica a anon/authenticated; (b) `is_team_member()` sozinho **não**
isola tenant — sempre combinar com `organization_id = get_user_organization_id()`.

## Policies por tabela (a preencher)

### `leads`
- `tenant_isolation_select`: `organization_id = auth.org_id()`
- `tenant_isolation_all`: ditto with check
- (verificar policies adicionais)

### `pipe_whatsapp` / `pipe_confirmacao` / `pipe_propostas`
- `tenant_isolation_*`
- INSTEAD OF INSERT fns (`SECURITY INVOKER`) com ghost-stage guard — ver §3 acima.
- (gate `move_pipe_record` é client-side hoje — [[move-pipe-record-server-side]] pendente)

### `copilot_agents`
- `tenant_isolation_*`
- `master_all_copilot_agents` (`FOR ALL USING (is_master_user())`) — `20260131200001`.

### `conversations` / `conversation_messages`
- `tenant_isolation_*`
- service_role via `auth.role() = 'service_role'` (`20260128050000`).
- (joins com leads validados via FK)

### `workflow_executions` / `workflow_execution_steps`
- `tenant_isolation_*`
- `*_service_role` `FOR ALL TO service_role` — ver §5 (W0-1).

### `goals`
- `goals_select_org` (org-wide read) + `goals_manage_admin_org` (admin/master write) — NULL-safe, ver §4.

(...)

## Auditoria

Pra listar todas as policies:

```sql
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Detectar policies service_role sem `TO service_role` (classe W0-1):

```sql
SELECT tablename, policyname, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname ILIKE '%service%role%'
  AND roles = '{public}';   -- alvo perigoso: {public} em vez de {service_role}
```

## Gotchas

- **JOINs cross-tabela** seguem policy de cada tabela isoladamente.
- **Service role bypassa RLS.** Cron jobs filtram manualmente.
- **`auth.org_id()` é NULL pra service_role.** Always check.
- **`UPDATE` sem `with_check`** permite mudar `organization_id` (vazamento).
  Sempre incluir `WITH CHECK`.
- **`INSERT` sem `with_check`** mesmo problema.
- **Policy service_role sem `TO service_role`** vale para anon/authenticated — ver §5.
- **Policy via FK opcional (`id = goals.team_member_id`) é NULL-blind** — ver §4.
- **`is_team_member()` não filtra org** sozinho — combinar com `organization_id`.
- **RLS + Realtime**: nunca `SELECT ... FROM team_members` inline em policy — usa
  `get_my_organization_ids()` / `get_my_admin_organization_ids()` /
  `get_my_team_member_ids()` (SECURITY DEFINER, bypassa RLS) para não disparar
  recursão de `apply_rls()`. Ver [[Areas Frageis]].

## Migration template

```sql
-- 20YYMMDDHHMMSS_<tabela>_rls.sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON <table>
  FOR SELECT USING (organization_id = auth.org_id());

CREATE POLICY "tenant_isolation_all" ON <table>
  FOR ALL
  USING (organization_id = auth.org_id())
  WITH CHECK (organization_id = auth.org_id());
```

## Teste obrigatório

`tests/integration/rls-<tabela>.test.ts`:
- User org A lê org A → OK
- User org A lê org B → 0 rows
- User org A insere com `organization_id = B` → fail (RLS bloqueia)
- Master cross-org → OK
