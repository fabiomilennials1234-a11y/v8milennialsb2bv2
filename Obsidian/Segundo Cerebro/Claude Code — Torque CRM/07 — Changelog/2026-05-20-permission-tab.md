# 2026-05-20 — Pitstop > Permissões tab

## Mudanças

- **Configurações (Pitstop)**: nova tab "Permissões" entre SLA e API Keys. 12 toggles em 7 grupos controlam o que role='member' pode fazer.
- **Engine**: `ACTION_TO_ORG_PERMISSION` adicionado (`create_lead`, `export_leads`, `view_lead`, `move_pipe_record`, `trigger_campaign`). Matriz legada reduzida — só `import_leads` permanece.
- **Frontend resolver**: catalog (`permission-catalog.ts`) é fonte única; mutation única abstrai destino dual (`organization_role_permissions` vs `feature_permissions`).
- **DB**: nova tabela `permission_audit_log` + trigger SECURITY DEFINER. CHECK constraint expandida para 9 keys. Backfill defaults-on em ~30 orgs existentes.
- **RLS Fase 1**: `leads_delete_admin_or_permission` agora respeita `can_delete_leads` (não só admin).
- **Realtime**: `organization_role_permissions` + `feature_permissions` na publication `supabase_realtime` (com RLS refatorada via `get_my_organization_ids()` para evitar recursion).
- **Seed trigger**: novas orgs recebem 9 rows enabled=true via `tg_seed_org_role_permissions`.

## Arquivos tocados

- `supabase/migrations/20260520000000_permission_tab_schema.sql` — schema + audit + seed + publication.
- `supabase/migrations/20260520000001_permission_tab_backfill.sql` — backfill defaults-on.
- `supabase/migrations/20260520000002_leads_delete_policy_update.sql` — RLS Fase 1.
- `supabase/functions/_shared/permission_engine.ts` — cascata atualizada.
- `src/lib/permissions.ts` — ACTION_TO_ORG_PERMISSION espelhado.
- `src/lib/permission-catalog.ts` — single source of truth (NEW).
- `src/hooks/useOrgRolePermissions.ts` — aggregator + realtime (NEW).
- `src/hooks/useUpdateRolePermission.ts` — mutation única com optimistic (NEW).
- `src/hooks/useResetOrgRolePermissions.ts` — bulk reset (NEW).
- `src/hooks/usePermissions.ts` — `PermissionKey` union expandida.
- `src/components/settings/PermissionsTab.tsx` — UI completa (NEW).
- `src/pages/Configuracoes.tsx` — tab registrada.
- `tests/unit/shared-permission-engine.test.ts` — cobertura nova cascata.
- `tests/unit/use-permissions-hooks.test.ts` — sync resolver atualizado (export_leads agora denied via fail-closed).
- `docs/PERMISSION-ENFORCEMENT.md` — seção Permission Tab + audit log.
- `Obsidian/.../04 — Decisões/ADR-2026-05-20-permission-tab-storage-split.md` (NEW).
- `Obsidian/.../06 — Features/Admin/Permissoes Sistema.md` — nota de header.
- `Obsidian/.../08 — Backlog/backlog/server-side-enforcement-phase2.md` (NEW).
- `Obsidian/.../08 — Backlog/backlog/consolidate-permissions-storage.md` (NEW).

## Decisões

- Storage split (D do grilling) — ver [ADR-2026-05-20-permission-tab-storage-split](../04%20—%20Decisões/ADR-2026-05-20-permission-tab-storage-split.md).
- Defaults-on no backfill — risco de exposição aceito pelo CTO (~30 orgs).
- Per-pipe orphan rows em `team_member_permissions` preservadas (não deletadas), engine apenas ignora pra `move_pipe_record`.
- Migrations não aplicadas em prod nesta sessão (default = dev only).

## Follow-ups

- **Fase 2** server-side enforcement — backlog [`server-side-enforcement-phase2`](../08%20—%20Backlog/backlog/server-side-enforcement-phase2.md).
- **Refactor storage** — backlog [`consolidate-permissions-storage`](../08%20—%20Backlog/backlog/consolidate-permissions-storage.md).
- **Pré-flight prod**: rodar `SELECT DISTINCT organization_id FROM team_member_permissions WHERE resource_key NOT IN ('leads','campanhas','pipe') AND value='denied'` antes de aplicar em prod.
- **Integration tests**: arquivos novos para `permission_audit_log`, `rls-leads-delete`, e `permission-tab-seed-trigger` NÃO foram escritos nesta sessão (skip — Supabase local não disponível neste ambiente, e tempo). Adicionar no PR de Fase 2.
- **CI baseline já era red** — `permissions-fail-closed.test.ts` e `use-permissions-hooks.test.ts` têm pré-existentes failures (referenciam `result.current.isSuccess`/`.data` da API antiga). Não introduzimos novas regressões; ajustamos apenas teste 11/11b para o novo contrato.
