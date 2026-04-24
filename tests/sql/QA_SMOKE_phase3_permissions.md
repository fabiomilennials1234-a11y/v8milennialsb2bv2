# QA Smoke — Permissões Membros (pós Fase 1 + Fase 2)

Incidente: 2026-04-24 — membros com tela bloqueada em todas as rotas; não conseguem desativar copilot.

Este checklist valida que as correções (frontend Fase 1 + DB Fase 2) destravam os cenários relatados sem regressão em admin/master.

## Ambientes

| # | Ambiente | Quando executar |
|---|----------|----------------|
| 1 | Local (`supabase start`) | Antes de push pra qualquer branch |
| 2 | DEV (`bcfadphgsibjzivtbjvc`) | Antes de merge em `main` |
| 3 | Produção (`jsjsmuncfkbsbzqzqhfq`) | Pós-deploy, com user de uma org piloto |

## Pré-condições

- [ ] Fase 1 deployed (frontend build contém `hotfix/permissions-members-lockout`)
- [ ] Fase 2 deployed (migration `20260917000100_fix_permissions_multi_org_deterministic.sql` aplicada)
- [ ] Usuário de teste em cada papel disponível:
  - Admin em 1 org
  - Member em 1 org (sem overrides de `member_feature_permissions`)
  - Member em 2+ orgs (multi-org — alvo principal do bug)
  - Master (bypass total)

## Fluxos — membro single-org

### F1. Login + carregamento inicial
- [ ] Login → dashboard carrega
- [ ] Sidebar mostra itens conforme permissão (sem "bloqueado" em tudo)
- [ ] DevTools Network: `get-member-permissions` retorna 200 com `features` populado
- [ ] Sem erros 400/500 em vermelho no Network durante carregamento

### F2. Navegação entre rotas protegidas
- [ ] `/leads` → kanban carrega (leads atribuídos visíveis)
- [ ] `/pipe-whatsapp` → sem Lock screen
- [ ] `/copilot` → lista de agentes visível
- [ ] `/automacoes` → dependendo de `workflows.view`, acessível ou Lock correto (admin_only)
- [ ] `/campanhas` → lista carrega

### F3. Toggle copilot (bug principal)
- [ ] Abrir `/copilot` → clicar toggle on/off em um agente existente
- [ ] Toggle atualiza estado visual sem erro
- [ ] Refresh da página: estado persiste (UPDATE RLS passou)
- [ ] DevTools Network: `PATCH /rest/v1/copilot_agents?id=eq.X` retorna 200 + row atualizada

### F4. Erro recuperável (regressão Fase 1)
- [ ] Simular falha: bloquear `get-member-permissions` no DevTools (network tab → block)
- [ ] Recarregar rota protegida → aparece tela "Não foi possível carregar suas permissões" + botão Recarregar (NÃO a tela Lock)
- [ ] Desbloquear + clicar Recarregar → volta a funcionar

## Fluxos — membro multi-org (crítico)

### F5. Org switcher
- [ ] User com team_member ativo em org A e org B
- [ ] Após login, `currentTeamMember` resolve pra uma das orgs
- [ ] Trocar org via switcher (ou setar `selected_org_id` no localStorage) → UI recarrega
- [ ] Sidebar + permissões refletem a nova org (dados da org correta, não cruzados)
- [ ] `get-member-permissions` chamado 2x — uma por org — body com `organization_id` distinto

### F6. Isolamento cross-org (segurança)
- [ ] Member de org A tenta acessar URL direta de lead de org B → kanban vazio ou erro (não vazamento)
- [ ] Member de org A não vê copilot_agents de org B em `/copilot`
- [ ] `SELECT * FROM copilot_agents` via cliente do member — retorna apenas rows das orgs onde ele tem team_member

## Fluxos — admin

### F7. Admin opera normal
- [ ] Admin de org A → todas as features liberadas na org A
- [ ] Admin de org A tenta acessar dados de org B (se tiver team_member lá como member) → **FINDING M2**: atualmente `is_user_admin()` é global, então pode ler leads de B com privilégio admin. Documentar comportamento. NÃO regressão desta PR.

## Fluxos — master

### F8. Master bypass
- [ ] Master acessa qualquer org via org switcher → tudo liberado
- [ ] Master toggle copilot em qualquer org → sucesso

## Validação DB (rodar SQL)

Executar `tests/sql/validate_permissions_phase2.sql` e verificar:

- [ ] Bloco 1 — funções esperadas presentes, todas `SECURITY DEFINER=true`
- [ ] Bloco 3 — ZERO policies usando `has_feature_permission(key)` sem org_id
- [ ] Bloco 4 — lista de multi-org batem com usuários reportados no incidente (spot-check manual)
- [ ] Bloco 8 — zero `team_members` órfãos ativos (user_id NULL + is_active=true)

## Telemetria (Fase 3.2 — já instrumentada)

- [ ] Sentry → filtro `feature:permissions` → observar se erros `get-member-permissions-http-error` caem a zero pós-deploy
- [ ] Edge function logs (Supabase Dashboard → `get-member-permissions` → Logs) → filtrar `"event":"get-member-permissions.auth_error"` — esperado cair drasticamente pós Fase 1

## Rollback (se algo quebrar)

### Fase 1 (frontend)
- Redeploy anterior via EasyPanel (Docker tag previous)
- Revert commit `bbd4d1a` + push `main`

### Fase 2 (DB)
- Migration é CREATE OR REPLACE + DROP/CREATE POLICY — reverter é recriar as versões antigas. Arquivos-fonte:
  - `has_feature_permission(key)` original: `20260804000000_refactor_roles_and_permissions.sql` linhas 236-277
  - `get_user_organization_id()` original: `20260130000000_security_fix_rls_policies.sql`
  - `can_manage_copilot()` original: `20260817000000_copilot_whatsapp_member_permissions.sql` linhas 17-28
  - `can_manage_whatsapp_instances()` original: `20260817000000_copilot_whatsapp_member_permissions.sql` linhas 30-41
  - Policies copilot_agents: `20260817000000_...` linhas 45-126
  - Policies whatsapp_instances: `20260817000000_...` linhas 128-205
  - Policies leads/pipes: `20260818100000_fix_leads_rls_use_feature_permissions.sql`
  - Policy lead_history: `20260901000000_fix_lead_history_rls_align_permissions.sql`
- Criar migration `_revert_phase2.sql` recompondo versões originais, aplicar via `supabase db push`

## Critério FINAL GO/NO-GO

| Resultado | Decisão |
|-----------|---------|
| Todos os itens F1-F8 passam + Validação DB OK + Zero novas exceções Sentry | ✅ GO produção |
| F3 (copilot toggle) falha | ❌ NO-GO — investigar RLS copilot_agents |
| F5 (multi-org) dá Lock screen | ❌ NO-GO — Fase 1 não resolveu, re-investigar frontend |
| F6 (isolamento) permite cross-org | 🚨 EMERGENCY ROLLBACK — Security breach |
| Telemetria mostra 400s persistentes | ❌ NO-GO — investigar edge function |
