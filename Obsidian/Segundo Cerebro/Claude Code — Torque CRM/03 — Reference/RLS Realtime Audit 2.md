---
audit: 2026-05-19
related-prd: Issue #284 — Modal Lead v2 (Fase 3 realtime)
related-issue: Issue #291 — RLS audit realtime
status: 1 RED → fix em migration 20261030000003
---

# RLS Realtime Audit (Issue #291)

PRD #284 / Fase 3 adiciona `useLeadDetailRealtime(leadId)` que subscribe
em **6 tabelas** simultaneamente via `postgres_changes` filtrados por
`lead_id`. Risco conhecido: quando uma policy de SELECT faz subquery
inline em `team_members`, o Realtime entra em recursão infinita ao
avaliar `apply_rls()` — `team_members` tem RLS que chama
`get_my_organization_ids()` que tenta ler `team_members` que dispara
RLS novamente.

Fix conhecido: substituir subqueries inline em `team_members` por
helpers `SECURITY DEFINER` que bypassam RLS:
- `get_my_organization_ids()`
- `get_my_admin_organization_ids()`
- `get_my_team_member_ids()`
- `get_user_organization_id()`
- `lead_in_my_org(uuid)`

## Audit por tabela

| Tabela              | Status | Migration mais recente            | Observação |
| --                  | --     | --                                | --         |
| `leads`             | 🟢      | 20261020                          | `get_my_organization_ids()` em SELECT/UPDATE/DELETE |
| `lead_comments`     | 🟢      | 20261023                          | `get_user_organization_id()` em SELECT/INSERT/UPDATE |
| `lead_tags`         | 🟢      | 20261029                          | helper `lead_in_my_org(lead_id)` |
| `pipeline_entries`  | 🟢      | 20261020                          | `get_my_organization_ids()` em todas |
| `pipe_proposta_items` | 🟢    | 20261021                          | `EXISTS (...pipeline_entries WHERE pe.organization_id IN (SELECT get_my_organization_ids()))` |
| `lead_history`      | 🔴 → 🟢 | 20260917 (RED) → 20261030 (fix)   | SELECT tinha `SELECT FROM team_members WHERE user_id = auth.uid()` inline |

## Detalhe — `lead_history` SELECT (antes)

Migration `20260917000100_fix_permissions_multi_org_deterministic.sql`:

```sql
CREATE POLICY "lead_history_select_by_lead"
  ON public.lead_history FOR SELECT
  USING (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members      -- 🔴 inline
        WHERE user_id = auth.uid() AND is_active = true
      )
      AND (...permissions cascade...)
    )
  );
```

## Fix — migration 20261030000003

Mesma cascata de permissões, mas a subquery inline em `team_members` vira
chamada do helper `get_my_organization_ids()`:

```sql
USING (
  lead_id IN (
    SELECT id FROM public.leads
    WHERE organization_id IN (SELECT public.get_my_organization_ids())  -- 🟢
      AND (...permissions cascade...)
  )
)
```

Demais policies de `lead_history` (INSERT/UPDATE/DELETE) já estavam OK
(migrations 20261016, 20260719). Apenas SELECT precisava de fix.

## AC items

- [x] Documento (este arquivo) listando policy por tabela + flag inline subquery.
- [x] Migration `20261030000003_lead_history_select_use_helper.sql` substitui a única policy 🔴.
- [ ] Apply em dev + smoke test Realtime nas 6 tabelas com modal aberto
      e mutation em outra sessão.
- [ ] CTO sign-off (HITL — segurança RLS).

## Test plan dev

```bash
# Aplica
supabase db push --linked --project-ref bcfadphgsibjzivtbjvc

# Smoke: na UI, abrir lead e em outra aba/cliente service_role
# inserir lead_history row pra mesma org. Esperar:
# - postgres_changes envia INSERT
# - UI invalida queryKey ["lead-timeline", leadId]
# - feed atualiza sem freeze (sem recursão)
```

## Histórico

- 2026-05-19 — audit + fix migration. CTO sign-off pendente.
