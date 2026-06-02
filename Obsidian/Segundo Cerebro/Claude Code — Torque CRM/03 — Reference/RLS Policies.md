---
type: reference
title: RLS Policies
status: draft
created: 2026-05-15
updated: 2026-05-15
tags: [reference, rls, security, multi-tenant]
related: ["[[Multi-tenancy]]", "[[Schema]]"]
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

## Policies por tabela (a preencher)

### `leads`
- `tenant_isolation_select`: `organization_id = auth.org_id()`
- `tenant_isolation_all`: ditto with check
- (verificar policies adicionais)

### `pipe_whatsapp` / `pipe_confirmacao` / `pipe_propostas`
- `tenant_isolation_*`
- (gate `move_pipe_record` é client-side hoje — [[move-pipe-record-server-side]] pendente)

### `copilot_agents`
- `tenant_isolation_*`
- (verificar policy de `default_agent`)

### `conversations` / `conversation_messages`
- `tenant_isolation_*`
- (joins com leads validados via FK)

### `workflow_executions`
- `tenant_isolation_*`

(...)

## Auditoria

Pra listar todas as policies:

```sql
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

## Gotchas

- **JOINs cross-tabela** seguem policy de cada tabela isoladamente.
- **Service role bypassa RLS.** Cron jobs filtram manualmente.
- **`auth.org_id()` é NULL pra service_role.** Always check.
- **`UPDATE` sem `with_check`** permite mudar `organization_id` (vazamento).
  Sempre incluir `WITH CHECK`.
- **`INSERT` sem `with_check`** mesmo problema.

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
