---
tags:
  - claude-code
  - feature
  - torque-crm
  - equipe
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Gestao de Time

## O que faz

CRUD de membros do time com roles, seat usage, invite via email, e permissoes por membro. Ponto central de gestao de pessoas na org.

## Regras de negocio

- Roles no codigo: `admin`, `master`, `membro` (NUNCA SDR/Closer — sao conceitos de negocio, usados apenas na UI)
- Seat limit por org (definido pelo plano)
- Admin pode editar roles, desativar membros, convidar novos via email
- Invite cria usuario no Supabase Auth + team_member

## Como o usuario usa

1. Equipe no menu lateral
2. Ve tabela de membros com role, status, job title
3. Barra de seats mostra uso vs limite
4. Pode convidar novo membro (email)
5. Pode editar role, desativar, ou gerenciar permissoes

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Equipe.tsx` — Pagina principal
- `src/components/team/TeamMemberCard.tsx` — Card do membro
- `src/components/team/TeamStats.tsx` — Stats agregados
- `src/components/team/MemberPermissions.tsx` — Gestao de permissoes
- `src/components/team/SeatUsageBar.tsx` — Barra de uso de seats

### Hooks

- `useTeamMembers()` — Lista membros ativos da org
- `useUpdateTeamMember()` — Editar role, status
- `useCurrentTeamMember()` — Dados do usuario logado
- `useUserRole()` — Permission checks

### Edge Functions

- `create-org-user` — Cria usuario Supabase + team_member
- `assign-user-to-org` — Vincula usuario existente a org

### Tabelas

- `team_members` — user_id, name, role, metric_type, is_active, job_title, avatar_url, organization_id
- `auth.users` — Supabase Auth
- `organizations` — Seat limits

---

## Historico de mudancas

## Links relacionados

- [[Permissoes Sistema]]
- [[Comissoes]]
- [[Metas]]
