---
tags:
  - claude-code
  - feature
  - torque-crm
  - admin
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Permissoes Sistema

> [!danger] Area Fragil
> Sistema de 3 camadas com issues recorrentes. Ao mexer: testar com role admin, membro, e master separadamente. Verificar RLS policies + feature_permissions + member_feature_permissions.

## O que faz

RBAC 4 camadas: master admin → org admin → feature permissions → member permissions. Controla criacao/exclusao de leads, gestao de time, workflows, campanhas, e acesso a features.

## Regras de negocio

- Master tem bypass total (invisivel para clientes)
- Admin tem acesso total dentro da org
- Feature permissions sao flags globais (is_admin_only, default_value)
- Member permissions overridam feature permissions por membro
- Matrix legada 9x5 (leads/campanhas/pipe/proposta x create/edit/delete/export/move)
- Actions checadas: move_pipe_record, import_leads, create_lead, delete_lead, trigger_campaign, edit_workflow, export_leads, view_lead, send_message, manage_team, manage_copilot

## Como o usuario usa

Transparente - permissoes aplicadas automaticamente. Admin pode gerenciar em Equipe → Permissoes do membro.

---

## Como funciona (tecnico)

### Frontend

- `src/lib/permissions.ts`:
  - `usePermission(key)` - Checa permissao da org
  - `useCanPerformAction(action)` - Checa se usuario pode executar acao
  - `useCanPerformActionAsync(action)` - Versao async com cascata completa
  - `useAllPermissions()` - Todas as permissoes
  - `assertIsAdmin()` / `assertOrgPermission()` / `checkMatrixPermission()` - Helpers imperativos

### Backend

- `supabase/functions/_shared/permission_engine.ts`:
  - `canUserPerformAction()` - Resolve cascata server-side

### Hooks

- `useUserRole()` - Role + feature_permissions
- `useFeaturePermissions()` - Flags de features
- `usePermission(key)` - Checa key especifica
- `useCurrentTeamMember()` - Record do usuario + matrix

### Tabelas

- `users_master` - Registros master admin
- `team_members` - Role (admin/membro) por org
- `feature_permissions` - Flags globais (is_admin_only, default_value)
- `member_feature_permissions` - Override por membro
- `team_member_permissions` - Matrix legada 9x5

### Testes

- `tests/integration/permission-engine.test.ts`
- `tests/integration/rls-role-based.test.ts`
- `tests/integration/rls-org-isolation.test.ts`

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Campanhas]]

- [[Copilot]]

- [[Gestao de Time]]
- [[Master Admin]]
