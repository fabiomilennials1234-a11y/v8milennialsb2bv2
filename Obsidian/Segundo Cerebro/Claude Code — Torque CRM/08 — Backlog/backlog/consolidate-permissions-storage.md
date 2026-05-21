---
status: backlog
priority: LOW
created: 2026-05-20
tags: [permissions, refactor, dx]
related-adr: ADR-2026-05-20-permission-tab-storage-split
---

# Consolidar storage de permissões — eliminar as 3 tabelas paralelas

## Contexto

Pós-2026-05-20 o CRM tem **3 sistemas paralelos**:

1. `organization_role_permissions` (+ override `team_member_org_permissions`).
2. `feature_permissions` (+ `member_feature_permissions`).
3. `team_member_permissions` (matriz legada).

A nova Permissions tab abstrai os dois primeiros via catalog. A matriz legada (#3) só é consultada para `import_leads` no engine.

## Estado-alvo

Uma tabela: `org_permissions` com:
- `organization_id uuid`
- `subject_type text` ('role' | 'team_member')
- `subject_id text` ('member' | uuid)
- `permission_key text`
- `enabled boolean`
- `created_at`, `updated_at`

Engine consulta uma única fonte com cascata `team_member` > `role`.

## Tarefas (ordem sugerida)

- [ ] Audit: quem ainda escreve em `team_member_permissions`? Migrar para o novo schema.
- [ ] Criar `org_permissions` (migration).
- [ ] Espelhar dados das 3 tabelas existentes para `org_permissions` (backfill).
- [ ] Apontar engine + resolver + hooks para `org_permissions`.
- [ ] Adicionar `org_permissions` à publication supabase_realtime.
- [ ] Atualizar Permissions tab para usar a tabela única.
- [ ] Deletar `organization_role_permissions`, `team_member_org_permissions`, `team_member_permissions` após período de bake.
- [ ] Refactor `feature_permissions` para per-org (pré-requisito para workflows/team/copilot terem comportamento per-org real).

## Riscos

- Migração de dados precisa ser idempotente e reversível.
- `member_feature_permissions` referencia `team_member_id` — preservar overrides.
- Multi-tenant: nunca usar service_role no backfill sem org_id explícito.

## Notas

Tarefa **LOW** porque atual funciona. Reabrir quando alguma feature precisar de cascata granular > 4 níveis.
