# Backlog — Findings MED/BAIXO de Security (pós Fase 2)

Origem: Security review da migration `20260917000100_fix_permissions_multi_org_deterministic.sql` (incidente 2026-04-24). Findings identificados, não críticos o bastante pra bloquear o hotfix, mas devem virar issues/tasks.

Mover pra Obsidian (`04 — Decisões/` ou `08 — Backlog/`) após merge do hotfix.

---

## 🟧 M2 — `is_user_admin()` sem escopo de organização (cross-org privilege)

**Severidade**: MÉDIA  
**Tipo**: Bug pré-existente (não introduzido pela Fase 2)

### Descrição
A função `is_user_admin()` retorna `true` se o usuário for admin em **qualquer** org. Policies em `leads` e `pipe_*` usam `is_user_admin() OR has_feature_permission(...)`. Consequência: user admin em org A + membro em org B lê/edita leads de org B com privilégio admin.

### Reprodução
```sql
-- user X é admin em org A, member em org B
SELECT public.is_user_admin();  -- retorna true (por causa de A)

-- acessando leads de org B:
-- policy: organization_id IN (team_members do user) AND (is_user_admin() OR ...)
-- Passa: tem team_member em B + is_user_admin() true (cross-org)
```

### Fix proposto
1. Criar sobrecarga `is_user_admin(p_org_id UUID)` — retorna true só se user é admin NA org explícita
2. Substituir chamadas em policies `leads`, `pipe_*`, `lead_history`, etc., passando `organization_id` da row
3. Manter versão sem param pra compat (delegando a `get_user_organization_id()`)

### Impacto
- Reduz privilégio cruzado indevido em orgs piloto/parceiros
- LGPD: evita que admin de org A veja dados de org B sem intenção

### Owner: DBA + Security  
### Estimate: 4h (migration + testes pgTAP + regression tests)

---

## 🟧 M3 — Performance `pipe_propostas` com 3 subqueries em `leads`

**Severidade**: MÉDIA (performance)  
**Tipo**: Pré-existente, levemente agravado pela Fase 2

### Descrição
Policies `pipe_propostas_*_by_permissions` executam 3 `SELECT FROM leads WHERE id = lead_id LIMIT 1` subqueries para obter `organization_id` e `sdr_id`. Em orgs com 50k+ propostas, SELECT sem admin vira lento. PostgreSQL não cacheia inline SELECT em policy entre chamadas da mesma row.

### Fix proposto — 2 opções

**A. LATERAL JOIN** (menos invasivo)
Reescrever policy usando subquery LATERAL uma única vez por row.

**B. Sincronizar colunas em `pipe_propostas`** (mais rápido em runtime)
Já existe trigger `sync_responsible_from_lead_to_pipes` pra responsible_id. Estender pra sincronizar `organization_id` e `sdr_id` também. Backfill via migration. Policy passa a usar colunas diretas.

Opção B é significativamente mais rápida mas demanda backfill + migration de trigger. A Fase 1+2 já destrava o bug funcional.

### Owner: DBA  
### Estimate: 6h (opção B)

---

## 🟨 B1 — `copilot.toggle` ignorado no RLS de `copilot_agents`

**Severidade**: BAIXA (design/UX)  
**Tipo**: Pré-existente

### Descrição
`can_manage_copilot(org_id)` usa `has_feature_permission('copilot.create', org_id)`. Member com `copilot.create=false` mas `copilot.toggle=true` é bloqueado de ligar/desligar agente. Design questionável — "desativar" ≠ "criar".

### Fix proposto
Dois caminhos:

**A. Separar policies**: `INSERT` exige `copilot.create`, `UPDATE (só is_active)` exige `copilot.toggle`, `UPDATE (outros campos)` exige `copilot.edit`, `DELETE` exige `copilot.delete`. Complexo de expressar em RLS puro.

**B. Simplificar feature keys**: eliminar `copilot.toggle` e usar só `copilot.edit` (update) + `copilot.create` + `copilot.delete`. Menos keys, mais claro.

### Owner: Frontend + Backend + Produto (decisão de UX)  
### Estimate: 2h (caminho B)

---

## 🟨 B2 — Mudança de semântica em `copilot_agent_faqs` / `kanban_rules`

**Severidade**: BAIXA (changelog)  
**Tipo**: Melhoria de segurança já aplicada na Fase 2

### Descrição
Policies antigas chamavam `can_manage_copilot()` sem param — usavam `get_user_organization_id()` arbitrário. Consequência: membro multi-org com permissão em org A conseguia gerenciar FAQ/kanban de agents em org B se `get_user_organization_id()` calhasse em A.

Fase 2 mudou pra `can_manage_copilot(ca.organization_id)` — exige permissão na org do agent.

### Ação
Documentar no changelog `07 — Changelog/2026-04-24.md`: "Permissão de FAQ/kanban do copilot agora é por org do agent (antes era bypass possível por multi-org)."

### Owner: Conductor (doc)  
### Estimate: 15min

---

## 🟨 B3 — Monitorar perf de `campanha_leads`

**Severidade**: BAIXA (observabilidade)

### Descrição
Policy `campanha_leads_select_by_permissions` faz subquery `SELECT organization_id FROM campanhas WHERE id = campanha_id LIMIT 1` dentro de `has_feature_permission(..., org_id)`. Aceitável enquanto volumes são ~30 orgs + <50k campanha_leads.

### Ação
Adicionar painel em Supabase Advisors (Performance) monitorando queries lentas em `campanha_leads`. Se aparecer, aplicar mesma estratégia da M3 (sincronizar `organization_id` na coluna).

### Owner: DBA (monitoramento)  
### Estimate: 1h (setup alerta)

---

## Checklist de follow-up

- [ ] Criar issues Linear/GitHub pra M2, M3, B1 (tagged `security:follow-up-2026-04-24`)
- [ ] Documentar B2 no changelog Obsidian
- [ ] Configurar alerta B3 nos Supabase Advisors
- [ ] Revisar em 30d: verificar se findings foram endereçados ou re-priorizados
