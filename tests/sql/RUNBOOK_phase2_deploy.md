# RUNBOOK — Hotfix Permissões Multi-Org (Fase 2 DB)

**Incidente**: 2026-04-24 — membros multi-org com telas bloqueadas e sem conseguir desativar copilot.
**Migration alvo**: `supabase/migrations/20260917000100_fix_permissions_multi_org_deterministic.sql`
**Branch**: `hotfix/permissions-members-lockout` (worktree `.claude/worktrees/hotfix-permissions`)

## Status da tentativa automática (2026-04-24)

- `supabase link --project-ref bcfadphgsibjzivtbjvc` → OK (sem prompt de senha).
- `supabase db push --dry-run` → **BLOQUEADO**. CLI detectou divergência entre histórico local e remoto:
  - Remote-only: `20260422000001`, `20260918000000`.
  - Local-only (pendentes, 19): `20260422000100/000101/150000/150001`, `20260423000050/000100/000200/000300/120000`, `20260905000050`, `20260907000050`, `20260908000050`, `20260910000100`, `20260916000000..000003`, `20260917000000`, `20260917000100`.
- `supabase db push` cego aplicaria 19 migrations em DEV → side-effects inaceitáveis. **Abortado**.

Deploy da migration alvo precisa ser feito via **SQL Editor direto** (não via `db push`), ou via histórico saneado em sessão supervisionada.

## Pré-requisitos

1. `supabase` CLI ≥ 2.90.0 autenticado (`supabase projects list` lista os 5 projetos).
2. Senha do DB de DEV e PROD (apenas se optar por caminho CLI).
3. Acesso ao SQL Editor do Supabase Dashboard com role `service_role` (caminho recomendado).
4. Commits das Fases 1 + 2 presentes na branch `hotfix/permissions-members-lockout` (confirmar com `git log --oneline | head -5`).

## Caminho recomendado: SQL Editor direto

Aplicar somente a migration alvo como script ad-hoc, sem mexer no histórico `supabase_migrations.schema_migrations`. Em seguida, registrar manualmente no histórico quando a PR da branch for mergeada.

### DEV — aplicar

1. Abrir SQL Editor de `bcfadphgsibjzivtbjvc` (Torque CRM | DESENVOLVIMENTO).
2. Copiar conteúdo integral de `supabase/migrations/20260917000100_fix_permissions_multi_org_deterministic.sql`.
3. Executar como `service_role`. Migration é idempotente (CREATE OR REPLACE + DROP POLICY IF EXISTS).
4. Registrar no histórico (opcional em DEV, obrigatório em PROD pra não reaplicar):
   ```sql
   INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
   VALUES ('20260917000100', 'fix_permissions_multi_org_deterministic', ARRAY[]::text[])
   ON CONFLICT (version) DO NOTHING;
   ```

### DEV — validar

Executar `tests/sql/validate_permissions_phase2.sql`:

- **BLOCO 1** — 4 nomes retornam, cada com 1–2 assinaturas, todas `prosecdef = true`:
  - `has_feature_permission(text)` + `has_feature_permission(text, uuid)`
  - `can_manage_copilot()` + `can_manage_copilot(uuid)`
  - `can_manage_whatsapp_instances()` + `can_manage_whatsapp_instances(uuid)`
  - `get_user_organization_id()`
- **BLOCO 3** — **0 rows**. Qualquer row = policy legada em tabelas-alvo.
- **BLOCO 4** — listar membros multi-org; spot-check pelo menos 1 usuário reportado.
- **BLOCO 8** — esperado 0 órfãos ativos (ou número estável conhecido).

## Critério GO / NO-GO para PROD

**GO** exige todos os itens abaixo em DEV:

- Bloco 1: todas as sobrecargas presentes, `prosecdef = true` em todas.
- Bloco 3: 0 rows.
- Bloco 4: spot-check de pelo menos um membro multi-org real → consegue acessar telas.
- Bloco 8: 0 órfãos ativos (ou baseline conhecido).
- Smoke manual em DEV: login com user membro de 2 orgs → acessa `/leads`, `/pipe-whatsapp`, `/copilot` sem 403; consegue abrir edição de copilot e toggle ativo/inativo.

**NO-GO** (cancelar deploy PROD):

- Bloco 1: função faltando ou `prosecdef = false`.
- Bloco 3: qualquer row com policy legada ainda usando `has_feature_permission(key)` sem `org_id`.
- Bloco 5: feature crítica (`copilot.view`, `leads.view`, `pipeline.view`) com `default_value = false` + `is_admin_only = false` → requer backfill em `member_feature_permissions` antes.
- Qualquer erro de SQL ao executar a migration.

## PROD — aplicar (somente após GO explícito do CTO)

1. Abrir SQL Editor de `jsjsmuncfkbsbzqzqhfq` (Torque CRM | PRODUÇÃO).
2. Anunciar janela no canal interno (migration < 5s, sem downtime esperado — CREATE OR REPLACE de functions e DROP+CREATE de policies rodam sob lock curto).
3. Executar o mesmo SQL de `20260917000100_fix_permissions_multi_org_deterministic.sql`.
4. Registrar no histórico:
   ```sql
   INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
   VALUES ('20260917000100', 'fix_permissions_multi_org_deterministic', ARRAY[]::text[])
   ON CONFLICT (version) DO NOTHING;
   ```
5. Rodar validação (`validate_permissions_phase2.sql`) em PROD — mesmos critérios do DEV.

## Smoke test pós-PROD

Com um membro real reportado no incidente (pegar email na saída do Bloco 4 em DEV):

1. Login como esse membro em `https://torquecrm.com.br`.
2. Navegar `/leads`, `/pipe-whatsapp`, `/pipe-confirmacao`, `/pipe-propostas`, `/copilot`, `/campanhas` — nenhuma deve retornar 403.
3. Em `/copilot`, abrir um agente ativo → clicar toggle "Ativo" → salvar → confirmar que persiste (não volta pro estado anterior).
4. Checar Sentry nos próximos 15 min por novos erros de RLS / `has_feature_permission`.
5. Se múltiplas orgs no login switcher: trocar de org e repetir nav acima; checar se as telas continuam acessíveis.

## Rollback

Se pós-deploy aparecer regressão:

1. **Não** use `DROP FUNCTION` das funções novas 2-arg — são aditivas e não substituem as antigas.
2. Reverter só se as policies do Bloco 3 quebrarem algo. Restaurar versões antigas das policies RLS a partir de:
   - `supabase/migrations/20260817000000_copilot_whatsapp_member_permissions.sql` — policies de `copilot_agents`, `copilot_agent_faqs`, `copilot_agent_kanban_rules`, `whatsapp_instances`.
   - `supabase/migrations/20260817000001_drop_permissive_copilot_policies.sql` — drops que a Fase 2 refaz.
   - `supabase/migrations/20260818100000_fix_leads_rls_use_feature_permissions.sql` — policies de `leads` e pipes.
   - `supabase/migrations/20260804000000_refactor_roles_and_permissions.sql` — baseline das funções `has_feature_permission` / `can_manage_*`.
3. Restaurar `get_user_organization_id()` à versão pré-hotfix (sem `ORDER BY`) **apenas** se a determinística provar regressão — improvável, já que `LIMIT 1` sem ordem é sempre pior.
4. Remover linha do histórico se restaurou tudo:
   ```sql
   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260917000100';
   ```
5. Logar incidente no Obsidian `07 — Changelog/YYYY-MM-DD.md`.

## Caminho alternativo (CLI) — para quando o histórico for saneado

Requer o usuário decidir explicitamente como tratar as 19 migrations pendentes em DEV (aplicar/marcar como revertidas/pull remoto). Não seguir sem plano escrito. Comandos de referência:

```bash
# Trazer estado remoto pro local (sobrescreve arquivos locais não aplicados)
supabase db pull --project-ref bcfadphgsibjzivtbjvc

# OU reparar histórico marcando placeholders aplicados como reverted
supabase migration repair --status reverted 20260422000001 20260918000000
supabase migration repair --status applied 20260422000100 20260422000101 \
  20260422150000 20260422150001 20260423000050 20260423000100 20260423000200 \
  20260423000300 20260423120000 20260905000050 20260907000050 20260908000050 \
  20260910000100 20260916000000 20260916000001 20260916000002 20260916000003 \
  20260917000000

# Só então:
supabase db push --dry-run
supabase db push
```

**Não rodar** esses comandos em PROD sem dry-run validado em DEV e aprovação explícita.
