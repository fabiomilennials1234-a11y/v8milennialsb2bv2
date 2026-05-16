---
type: feature
title: WhatsApp Write Instance — Schema (Etapa A)
status: active
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
---

# WhatsApp Write Instance — Schema (Etapa A)

## O que é

Vinculo 1:1 entre usuário (team_member) e instância WhatsApp de escrita ativa por organização. Garante que todo envio de mensagem por um lead seja roteado pela instância do **responsável** desse lead. Admin da org e master da plataforma têm bypass — podem escrever via qualquer instância da org.

Etapa A entrega só schema/DB (sem código TS, sem edge function, sem frontend). O comportamento ainda não é exigido — gating fica na feature flag `user_write_instance_strict` (default OFF) que será consumida nas etapas B/C.

## Como funciona

### Schema

| Tabela | Coluna | Tipo | Origem |
|---|---|---|---|
| `whatsapp_instances` | `owner_team_member_id` | `uuid` FK→`team_members(id)` ON DELETE SET NULL | Nova |
| `leads` | `responsible_user_id` | `uuid` FK→`team_members(id)` ON DELETE SET NULL | Nova (fecha gap docs↔schema) |
| `whatsapp_instance_owner_history` | tabela inteira | auditoria | Nova |
| `feature_flags` | row `user_write_instance_strict` | seed | Nova |

### Constraints chave

- **Unicidade do owner por org**: índice único parcial `uq_whatsapp_instances_owner_per_org` em `(organization_id, owner_team_member_id) WHERE owner_team_member_id IS NOT NULL`. Garante que cada user tem no máximo 1 instância de escrita ativa naquela org. NULL é permitido em N instâncias (instâncias sem owner ainda funcionam para admin/master).
- **Mesma org**: `set_instance_owner` valida que o `team_member` pertence à mesma org da instância e está `is_active = true`.
- **FK SET NULL**: deletar `team_member` zera o vínculo, mas mantém a instância e o histórico (auditoria preservada).

### Auditoria — `whatsapp_instance_owner_history`

| Coluna | Descrição |
|---|---|
| `instance_id` | FK→`whatsapp_instances` (CASCADE) |
| `organization_id` | FK→`organizations` (CASCADE) — denormalizado para policy/index |
| `previous_owner_id`, `new_owner_id` | FK→`team_members` (SET NULL) |
| `changed_by` | FK→`auth.users` (SET NULL) |
| `changed_at` | `timestamptz NOT NULL DEFAULT now()` |
| `reason` | `text` opcional |

**RLS**:
- SELECT: membros ativos da org (via `team_members`) OU master.
- INSERT/UPDATE/DELETE: somente `service_role`. A única origem de escrita legítima é a RPC `set_instance_owner` (SECURITY DEFINER).

Índices:
- `idx_wioh_instance_id (instance_id, changed_at DESC)`
- `idx_wioh_organization_id (organization_id, changed_at DESC)`

### Feature flag

`user_write_instance_strict` — `category: whatsapp`, `default_enabled: false`. Gating do enforcement do regime estrito. Quando ON, o envio falha se a instância resolvida pelo responsável não existe; quando OFF, fallback documentado nas etapas seguintes.

### RPCs

Todas com `SECURITY DEFINER` + `SET search_path = public`. Grants `EXECUTE` para `authenticated` (e `service_role` quando aplicável); `REVOKE` em `PUBLIC`.

| RPC | Assinatura | Retorno | Quem pode chamar |
|---|---|---|---|
| `get_user_write_instance` | `(p_user_id uuid, p_organization_id uuid)` | `TABLE(instance_id, instance_name)` | `authenticated`, `service_role` |
| `get_lead_write_instance` | `(p_lead_id uuid)` | `TABLE(instance_id, instance_name, owner_team_member_id, responsible_user_id, error_code)` | `authenticated`, `service_role` |
| `can_user_write_instance` | `(p_user_id uuid, p_instance_id uuid)` | `boolean` | `authenticated`, `service_role` |
| `set_instance_owner` | `(p_instance_id uuid, p_new_owner_team_member_id uuid, p_reason text)` | `uuid` (audit_id) | `authenticated` (admin/master only) |

### Error codes — `get_lead_write_instance`

| Code | Significado |
|---|---|
| `LEAD_NOT_FOUND` | Lead não existe |
| `NO_RESPONSIBLE` | Lead sem `responsible_user_id` |
| `NO_INSTANCE` | Responsible existe mas não há instância vinculada (owner_team_member_id) |
| `NULL` (sucesso) | `instance_id` populado |

### Bypass de autorização — `can_user_write_instance`

A função retorna `true` se qualquer condição:
1. `is_master_user(p_user_id) = true` (master plataforma).
2. `team_members.role = 'admin'` na org da instância (admin org).
3. `owner_team_member_id` da instância = `team_member` ativo do user na org (owner direto).

## Regras de negócio

- 1 user → 1 instância de escrita por org (constraint única).
- Master da plataforma sempre pode escrever em qualquer instância de qualquer org.
- Admin da org sempre pode escrever em qualquer instância da sua org.
- Membro só pode escrever via instância da qual é owner.
- Trocar owner é ação privilegiada (admin/master) e gera 1 row de auditoria por troca.
- `set_instance_owner` aceita `NULL` para "desvincular" (instância sem owner — só admin/master escreve).
- Backfill é idempotente: só preenche quando a coluna está `NULL` e há fonte determinística.

## Backfill aplicado nesta migration

1. **`leads.responsible_user_id`** ← `COALESCE(closer_id, sdr_id)` quando `responsible_user_id IS NULL` e há ao menos um dos dois.
2. **`whatsapp_instances.owner_team_member_id`** ← único `team_member_id` em `whatsapp_instance_allowed_members` quando exatamente 1 row para a instância e `owner_team_member_id IS NULL`. Quando 0 ou 2+ rows, fica NULL (decisão manual via `set_instance_owner`).

## Áreas frágeis tocadas

- **WhatsApp/Uazapi**: schema agora tem owner. Edge functions e front continuam atuando sem mudança até as etapas B/C. Default da flag é OFF — comportamento legado preservado.
- **Multi-tenancy**: a unicidade é por `(organization_id, owner_team_member_id)`. RLS de `whatsapp_instance_owner_history` filtra por org via `team_members.organization_id`. Nenhum vazamento cross-tenant nas RPCs (todas filtram por org da instância).
- **Permissões**: bypass admin/master no `can_user_write_instance` e `set_instance_owner` usa `is_master_user()` + `team_members.role = 'admin'` + `is_active`. Coerente com convenções existentes (`master_users`, `team_members`).

## Edge cases

- Lead sem responsável → `error_code = NO_RESPONSIBLE`.
- Lead com responsável mas sem instância vinculada → `error_code = NO_INSTANCE`.
- User não é membro da org → `can_user_write_instance` retorna `false`.
- User é membro mas não é admin nem owner → `false`.
- `set_instance_owner` com `team_member` de outra org → `RAISE EXCEPTION INVALID_OWNER`.
- `set_instance_owner` com `team_member` inativo → `RAISE EXCEPTION INVALID_OWNER`.
- Owner trocado de A → B: 1 row em `whatsapp_instance_owner_history` com `previous_owner_id=A`, `new_owner_id=B`.
- Owner setado para NULL: row com `new_owner_id=NULL` (válido).
- Tentativa de UPDATE/DELETE direto em `whatsapp_instance_owner_history` por user normal → bloqueado por RLS (somente `service_role`).

## Pendências e decisões

- **Type regen pendente**: `supabase gen types typescript --project-id bcfadphgsibjzivtbjvc` falhou nesta sessão por falta de `SUPABASE_ACCESS_TOKEN`. CTO precisa rodar manualmente após apply da migration em DEV. Sem regen, hooks/components TS continuam compilando (colunas novas só serão tipadas após).
- **Migration ainda não aplicada**: arquivo deixado em `supabase/migrations/`. Apply em DEV (`bcfadphgsibjzivtbjvc`) por enquanto fica a critério do arquiteto. Não aplicar em prod sem pedido explícito do CTO.
- **`is_master_user()` reutilizada** em vez de inline `EXISTS` — coerente com o padrão do resto do schema (`master_set_copilot_disabled_rpc`, `master_override_billing` etc.).
- **`whatsapp_instance_allowed_members` permanece**: continua válida para o caso "vários membros podem responder por essa instância" (fluxo legado). Quando o regime estrito (etapas B/C) entrar via flag, esse modelo será revisado/aposentado.
- **Trigger de auditoria automático não foi criado**: trocas só geram histórico via `set_instance_owner`. Updates diretos via `service_role` na coluna `owner_team_member_id` (ex: hotfix manual) não geram histórico. Considerar trigger AFTER UPDATE em etapas futuras se preciso.

## Arquivos

- Migration: `supabase/migrations/20260930000000_user_write_instance.sql`
- Doc: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/whatsapp-write-instance/01-schema.md`

## Histórico

- **2026-09-30** — Etapa A criada (schema + RPCs + RLS + backfill). Migration ainda não aplicada. Type regen pendente.
