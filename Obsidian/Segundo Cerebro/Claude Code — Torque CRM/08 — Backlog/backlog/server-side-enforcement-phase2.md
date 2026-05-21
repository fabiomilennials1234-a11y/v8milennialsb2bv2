---
status: backlog
priority: MEDIUM
created: 2026-05-20
tags: [permissions, security, server-side]
related-adr: ADR-2026-05-20-permission-tab-storage-split
---

# Server-side enforcement Phase 2 — 7 toggles ainda frontend-only

## Contexto

A Permissions tab lançou em 2026-05-20 com 12 toggles. **Fase 1** adicionou enforcement server-side só para `can_delete_leads` via policy `leads_delete_admin_or_permission` em `leads`.

As outras **7 keys** são **frontend-only**: usuário com console + JWT consegue burlar.

## Lista de keys sem enforcement server-side

| Key | Onde frontend gateia | Bypass possível |
|---|---|---|
| `can_create_leads` | `useCanPerformActionAsync('create_lead')` em LeadCreateModal | POST direto em `/rest/v1/leads` |
| `can_export_leads` | botão "Exportar" hidden via hook | requisição de export manual |
| `see_all_leads` | filtro SQL no useLeads | n/a — RLS já cobre (mantido por questões históricas) |
| `can_move_pipe_records` | drag-and-drop disabled | UPDATE direto em pipeline_entries |
| `can_manage_campaigns` | controles UI ocultos | INSERT/UPDATE em campanhas |
| `can_manage_workflows` | controles UI ocultos | INSERT/UPDATE em workflows |
| `can_manage_team` | rota /time bloqueada | INSERT/UPDATE em team_members |

## Tarefas

### RLS policies
- [ ] `leads_insert_create_permission` em `leads` → `can_create_leads`
- [ ] `pipeline_entries_update_move_permission` em `pipeline_entries` → `can_move_pipe_records` (cuidado com Realtime recursion — usar SECURITY DEFINER helper)
- [ ] `campanhas_modify_permission` em `campanhas` + `campanha_stages` → `can_manage_campaigns`
- [ ] `workflows_modify_permission` em `workflows` → `can_manage_workflows`
- [ ] `team_members_modify_permission` (já existe parcial) → consolidar com `can_manage_team`

### Edge function assertPermission
- [ ] `mass-send-create` já gate. Auditar outros edge fns de campanhas.
- [ ] Edge fns de export → assertPermission('export_leads').

### Testes
- [ ] `tests/integration/rls-can-create-leads.test.ts`
- [ ] `tests/integration/rls-can-move-pipe-records.test.ts`
- [ ] `tests/integration/rls-can-manage-campaigns.test.ts`
- [ ] Cross-tenant matrix: org A com `can_create_leads=false` impede INSERT mesmo via service_role? (Não — service_role bypassa RLS por design; documentar.)

## Critério de "done"

Todas as 7 keys têm enforcement no banco OU edge function. PERMISSION-ENFORCEMENT.md atualizado com cada nova policy.

## Notas

- Manter parity entre engine (`ACTION_TO_ORG_PERMISSION`) e RLS — qualquer divergência permite confused-deputy.
- `feature_permissions.default_value` é **global** — workflows/team/copilot exigem feature_permissions refactor para per-org antes do RLS fazer sentido.
