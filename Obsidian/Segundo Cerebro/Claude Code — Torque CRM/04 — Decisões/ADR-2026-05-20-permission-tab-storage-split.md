---
status: accepted
date: 2026-05-20
deciders: CTO
tags: [permissions, architecture, multi-tenant]
---

# ADR-2026-05-20 — Permission Tab storage split

## Contexto

Em 2026-05-20 lançamos a tela **Pitstop > Permissões** com 12 toggles em 7 grupos. O CRM hoje convive com **3 sistemas paralelos** de permissão:

1. **`organization_role_permissions`** — desde 2026-02-04 (`see_*`) com extensão silenciosa em 2026-02-22 (`team_member_org_permissions` override individual + branch `delete_lead`).
2. **`feature_permissions` + `member_feature_permissions`** — sistema "moderno" para features (workflows/team/copilot/whatsapp), gerenciado por `get-member-permissions` edge function.
3. **`team_member_permissions` (matriz)** — sistema legado, recurso × ação × valor (`allowed` | `denied` | `allowed_own`).

A pergunta foi: **onde armazenar as 12 novas toggles?**

## Decisão

**Expansão controlada (opção D do `/grill-me`):**

- **9 toggles** vão em `organization_role_permissions` (com role='member'):
  - `see_unassigned_cards`, `see_subordinates_cards`, `see_general_info`, `see_all_leads` (legacy — já existiam).
  - `can_delete_leads` (já existia via branch dedicada no engine).
  - `can_create_leads`, `can_export_leads`, `can_move_pipe_records`, `can_manage_campaigns` (novos, 2026-05-20).
- **3 toggles** vão em `feature_permissions.default_value` (gerenciamento de módulo):
  - `can_manage_workflows` → `workflows.create`
  - `can_manage_team` → `team.view`
  - `can_manage_copilot` → `copilot.create`

A UI desconhece o split: o hook `useUpdateRolePermission` consulta o catalog (`src/lib/permission-catalog.ts`) e roteia para a tabela correta. Mutation única para o componente.

A matriz legada `team_member_permissions` **deixa de ser escrita** pela nova tela, mas o engine continua consultando como fallback para `import_leads` (única ação sem equivalente em `organization_role_permissions`).

### Cascata de leitura

`master → admin → ACTION_TO_FEATURE → delete_lead (branch dedicada) → ACTION_TO_ORG_PERMISSION → ACTION_TO_MATRIX (só import_leads) → permission_not_defined (deny)`.

A constante `ACTION_TO_ORG_PERMISSION` é mantida em paralelo no engine (`supabase/functions/_shared/permission_engine.ts`) e no resolver frontend (`src/lib/permissions.ts`).

## Consequências

### Positivo
- **Zero migração destrutiva.** Orgs existentes seguem operando; backfill flipa `enabled=true` para legacy keys + insere as novas com defaults-on.
- **UI tem fonte única** (catalog) que dita label, descrição, destino de mutação e flag `hasRls`.
- **Realtime broadcast** funciona via publication em `organization_role_permissions` e `feature_permissions`.
- **Audit log dedicado** (`permission_audit_log`) captura toggles via trigger SECURITY DEFINER.

### Negativo / dívida técnica
- Coexistência das 3 tabelas confunde manutenção. **Backlog item** [`consolidate-permissions-storage`](../08%20—%20Backlog/backlog/consolidate-permissions-storage.md).
- Server-side enforcement só foi adicionado para `can_delete_leads` (Fase 1 via RLS em `leads`). As outras 7 keys são **frontend-only**. **Backlog item** [`server-side-enforcement-phase2`](../08%20—%20Backlog/backlog/server-side-enforcement-phase2.md).
- `feature_permissions.default_value` é **global** (não por org). Mudar `workflows.create` afeta TODAS as orgs. Aceito como dívida — refactor para per-org `feature_permissions` cabe em outra ADR.
- Per-pipe orphan rows em `team_member_permissions` (resource_key = pipe uuid, value='denied') deixam de surtir efeito após a migração de `move_pipe_record` para `can_move_pipe_records`. Não deletamos para preservar histórico; pré-flight em prod recomendado.

## Alternativas descartadas

- **(A) Big bang unification.** Migrar tudo para `organization_role_permissions` agora. Riscoso, perde compat. Rejeitado.
- **(B) Tabela greenfield `org_permissions_v2`.** Quarta tabela paralela. Acelera dívida. Rejeitado.
- **(C) Espelho multi-tabela síncrono via trigger.** Sob o capô a tela escreveria em duas tabelas para todos os 12 toggles. Trigger cross-tabela é frágil. Rejeitado.

## Implementação

| Item | Path |
|---|---|
| Catalog | `src/lib/permission-catalog.ts` |
| Hook agregador | `src/hooks/useOrgRolePermissions.ts` |
| Mutation única | `src/hooks/useUpdateRolePermission.ts` |
| Reset bulk | `src/hooks/useResetOrgRolePermissions.ts` |
| UI tab | `src/components/settings/PermissionsTab.tsx` |
| Engine update | `supabase/functions/_shared/permission_engine.ts` |
| Resolver frontend | `src/lib/permissions.ts` |
| Migrations | `supabase/migrations/20260520000000_permission_tab_schema.sql`, `20260520000001_permission_tab_backfill.sql`, `20260520000002_leads_delete_policy_update.sql` |

## Referências
- [grilling consolidado] sessão CTO 2026-05-20.
- [Permissoes Sistema](../06%20—%20Features/Admin/Permissoes%20Sistema.md) — feature doc.
- [Multi-tenancy](../02%20—%20Arquitetura/Multi-tenancy.md).
