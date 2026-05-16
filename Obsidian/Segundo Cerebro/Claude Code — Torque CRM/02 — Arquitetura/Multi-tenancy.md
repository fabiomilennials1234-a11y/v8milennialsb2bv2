---
type: architecture
title: Multi-tenancy
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [arquitetura, multi-tenant, security]
related: ["[[Visao Geral]]", "[[Permissoes Sistema]]", "[[RLS Policies]]"]
owner: gabriel
---

# Multi-tenancy — Como o Torque isola tenants

> Diátaxis: **Explanation**. Modelo + por quê.
> Para lookup de policies específicas, ver [[RLS Policies]].
> Para deploy seguro de migration, ver [[aplicar-migration-prod]].

## Modelo

**Shared schema, RLS-enforced isolation.**

Todos os tenants vivem no mesmo banco Postgres. A tabela `organizations` é o
tenant table. Toda outra tabela com dados de cliente tem coluna
`organization_id uuid references organizations(id)`. RLS policies em cada
tabela garantem que queries só retornam linhas onde
`organization_id = auth.org_id()` (extraído do JWT).

## Por que shared schema (não DB-per-tenant)

| Critério | Shared schema | DB-per-tenant |
|---|---|---|
| Custo Supabase | 1 instância | 30 instâncias |
| Operação (migrations) | 1 deploy | 30 deploys |
| Onboarding nova org | 1 INSERT em `organizations` | provisionar DB inteiro |
| Risco vazamento | RLS + auditoria | isolamento físico |
| Performance | índices em `organization_id` | natural por DB |
| Recovery seletivo | mais difícil | mais fácil |

Decisão: shared. Custo + simplicidade operacional > isolamento físico.
Compensação: defesa em profundidade em RLS + testes + auditoria.

## Princípios duros

1. **Toda query filtra `organization_id`.**
   - Mesmo com RLS, filtrar explicitamente no `where` (defense in depth).
   - Hooks frontend: `useQuery({ queryKey: [table, orgId], enabled: !!orgId })`.
2. **Frontend nunca envia `organization_id`.**
   - Vem do auth context (`useAuth().organization_id`).
   - Edge functions extraem do JWT (`auth.org_id()`).
3. **RLS por padrão em toda tabela com `organization_id`.**
   - Migration que cria tabela sem RLS → fail review.
4. **Cross-org access = master role only.**
   - Master pode ver/editar qualquer org via UI dedicada (`/master/*`).
   - Endpoints com `master_only: true` em config.
5. **Auditoria de cross-org actions.**
   - Tabela `master_audit_log`. Triggers em mudanças sensíveis.

## Onde mora cada peça

### DB
- `organizations` — tabela tenant
- `organization_members` — relação user ↔ org (role: admin/master/membro)
- `team_members` — vendas + comissões (subset de membros)
- `organization_settings` — config por org

### Auth
- Supabase Auth + `organization_id` em JWT custom claims
- Função SQL `auth.org_id()` extrai do JWT
- Hook `useAuth()` expõe `user`, `organization`, `role`

### RLS
- Policy template:
  ```sql
  CREATE POLICY "tenant_isolation_select" ON <table>
    FOR SELECT USING (organization_id = auth.org_id());
  CREATE POLICY "tenant_isolation_modify" ON <table>
    FOR ALL USING (organization_id = auth.org_id())
    WITH CHECK (organization_id = auth.org_id());
  ```
- Ver [[RLS Policies]] para lista completa por tabela.

### Edge Functions
- Padrão: extrair `org_id` do JWT, validar, filtrar query.
- Helper: `_shared/auth.ts` — `getOrgIdFromRequest(req)`.
- Service role bypass: **só** em jobs internos (cron, webhooks de provider).

## Anti-patterns conhecidos

❌ Frontend manda `organization_id` no body — pode ser forjado.
❌ Edge fn usa service role sem validar org — bypassa RLS.
❌ Query sem `where organization_id` confia 100% em RLS — sem defense in depth.
❌ JOIN cross-org sem policy de FK — vazamento.
❌ INSERT com `organization_id` literal sem checar contra auth — escalada.

## Onboarding nova org

Fluxo: ver [[criar-nova-org]].

Resumo: `checkout-provision-org` cria org + plano + admin user. `create-org-user`
para usuários adicionais. WhatsApp via wizard separado.

## Org Milennials (especial)

A própria Milennials usa o sistema. Org `6030520a-2ca7-477d-be89-55758e2cd808`.
Tratamento normal — sem código especial, só dados próprios.

## Gotchas

- **`auth.org_id()` retorna NULL pra service role.** Cron jobs precisam
  filtrar manualmente por `organization_id` no payload.
- **`update existing if match` em webhooks** pode unir leads de orgs diferentes
  se filtro mal feito. Cuidado em `lead-webhook` — sempre escopo por org.
- **realtime postgres_changes** respeita RLS automaticamente.
- **Storage buckets** precisam path com `org_id/` no início + RLS.

## Testes obrigatórios

Quando mexer em multi-tenancy ou RLS:
1. Teste positivo: user da org A acessa dados da org A — passa.
2. Teste negativo: user da org A tenta acessar dados da org B — bloqueia.
3. Teste de bypass: service role + filtro manual — passa.
4. Teste de bypass: service role sem filtro — falha visivelmente.

Ver `tests/integration/multi-tenancy.test.ts` (a criar/atualizar).

## ADRs relacionadas

- [[ADR-2026-04-27-refactor-agent-engine-modular]] — refactor copilot mantém scope per org
- [[ADR-2026-04-30-meeting-date-sync]] — filtros defensivos `.eq("organization_id")` em UPDATEs cross-tabela
