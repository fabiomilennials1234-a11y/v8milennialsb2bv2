---
date: 2026-04-23
branch: fix/funis-access-multi-org-rls
agents: [Conductor, Security, DBA, Backend, Frontend, QA]
---

# 2026-04-23 — fix(permissions): funis bloqueados / vazios para usuários multi-org

## Incidente

Usuários reportados sem acesso às rotas `/funis`, `/pipe-whatsapp`, `/pipe-confirmacao`, `/pipe-propostas`:

- Weder-Milennials
- Vagner
- Mateus - Vanilla Brasil

Em alguns casos o funil abre mas aparece **vazio ou com cards faltando**.

## Causa raiz — 3 vetores convergindo

### Vetor A (primário) — `useFeaturePermissions` não envia `organization_id`

[useUserRole.ts:148](../../../../src/hooks/useUserRole.ts#L148) (pré-fix) enviava `body: JSON.stringify({})` para `get-member-permissions`. A edge, via [requireAuth](../../../../supabase/functions/_shared/user-auth.ts), caía no fallback "primeiro `team_member` ativo por `created_at`" quando não recebia org. Para membros de múltiplas orgs, o resultado era avaliar `pipeline.view` contra a **org errada** — bloqueando (ou liberando) rota independentemente da org em que o usuário estava navegando.

### Vetor B (secundário) — drift `pipe_*` vs `leads` sem o fix do trigger

Migration [20260417110000_fix_pipe_closer_sdr_sync.sql](../../../../supabase/migrations/20260417110000_fix_pipe_closer_sdr_sync.sql) foi validada em dev (`bcfadphgsibjzivtbjvc`) mas **não aplicada em produção** (`jsjsmuncfkbsbzqzqhfq`). Sem ela, o trigger só sincroniza `responsible_id`; transferência de closer/sdr via `leads.{closer_id, sdr_id}` deixa `pipe_*.{closer_id, sdr_id}` obsoleto. RLS lê colunas do pipe → quem transferiu o card continua vendo, quem recebeu não vê. Isso explica o sintoma "funil abre vazio/faltando cards".

### Vetor C (paralelo, PR separado) — `has_feature_permission` usa `get_user_organization_id()`

Descoberto durante a triagem. Em [20260130000000_security_fix_rls_policies.sql:41](../../../../supabase/migrations/20260130000000_security_fix_rls_policies.sql#L41) e redefinida em [20260303000000](../../../../supabase/migrations/20260303000000_performance_optimization_rls_indexes.sql#L211) e [20260320000000](../../../../supabase/migrations/20260320000000_fix_followups_rls_and_time_based_automations.sql#L14), a função `get_user_organization_id()` escolhe o primeiro `team_members` ativo sem honrar "org selecionada". Como `has_feature_permission('leads.view_all')` depende dela, RLS de `leads`/`pipe_*` avalia `leads.view_all` contra a org errada para usuários multi-org — mesmo com o Vetor A corrigido. **Escopo maior, fica para PR dedicado** (`has_feature_permission_in_org(feature, org_id)` + atualização de todas as policies para passar `organization_id` da row).

## Correções aplicadas (branch `fix/funis-access-multi-org-rls`)

### Frontend
- [src/hooks/useUserRole.ts](../../../../src/hooks/useUserRole.ts) — `useFeaturePermissions` lê `organization_id` do `useCurrentTeamMember`, envia no body e inclui na `queryKey`. Troca de org força refetch; queryKey diferente garante isolamento de cache.
- [src/components/pipelines/GhostLeadsBanner.tsx](../../../../src/components/pipelines/GhostLeadsBanner.tsx) — **novo**. Substitui o filtro silencioso `if (!lead) return false` por aviso explícito + telemetria `pipe.ghost_leads_detected` em `usage_events` (rastreável por org).
- [src/pages/PipeWhatsapp.tsx](../../../../src/pages/PipeWhatsapp.tsx), [PipeConfirmacao.tsx](../../../../src/pages/PipeConfirmacao.tsx), [PipePropostas.tsx](../../../../src/pages/PipePropostas.tsx) — calculam `ghostLeadsCount` e renderizam o banner no topo.

### Backend
- [supabase/functions/_shared/user-auth.ts](../../../../supabase/functions/_shared/user-auth.ts) — `requireAuth` ganha opção `requireOrganization`. Quando `true` e o request não fornece `organization_id` (e user não é master), falha com `AuthError 400`. Modo non-strict mantém o fallback mas agora emite `console.warn` estruturado `requireAuth.org_fallback_used` com `user_id` + URL — caçar callers que ainda dependem do fallback.
- [supabase/functions/get-member-permissions/index.ts](../../../../supabase/functions/get-member-permissions/index.ts) — usa `requireOrganization: true`. Frontend passa a ser obrigado a enviar `organization_id`.

### DB
- [supabase/migrations/20260423120000_verify_pipe_sync_and_backfill.sql](../../../../supabase/migrations/20260423120000_verify_pipe_sync_and_backfill.sql) — **nova**. Re-declara função + trigger canônico (idempotente, superset de 20260417110000), backfill completo dos 4 invariants, view `v_pipe_responsibility_drift` para monitoramento runtime, bloco de validação que aborta se drift persistir ou se trigger não cobrir `(responsible_id, closer_id, sdr_id)`. **Não aplicada em prod** — pendente de autorização.

### Testes
- [tests/unit/shared-user-auth.test.ts](../../../../tests/unit/shared-user-auth.test.ts) — +4 testes: `requireOrganization=true` sem orgId → 400 (multi-org user); resolve org exata via `body.organization_id`; master bypassa; org alheia → 403.
- [tests/unit/use-feature-permissions-orgid.test.ts](../../../../tests/unit/use-feature-permissions-orgid.test.ts) — **novo**. 4 testes: body contém `organization_id` da org selecionada; troca de org refetch com new body; sem team_member → 0 fetches; header `X-User-JWT` contém access_token, `Authorization` usa anon_key (nunca service role).
- [tests/unit/ghost-leads-banner.test.tsx](../../../../tests/unit/ghost-leads-banner.test.tsx) — **novo**. 7 testes: renders 0/1/N, telemetria única por (orgId, count), telemetria não dispara sem orgId, re-telemetria só quando count muda.
- [tests/sql/diagnose_funis_access_multi_org.sql](../../../../tests/sql/diagnose_funis_access_multi_org.sql) — **novo**. 8 blocos de investigação para rodar em prod por usuário afetado.

## Validação (ambiente dev local)

- `npx tsc --noEmit` → 0 erros.
- Testes diretamente tocados: **141 passed** em 7 arquivos (shared-user-auth, use-feature-permissions-orgid, ghost-leads-banner, permission-protected-route, use-permissions-hooks, permissions, shared-permission-engine).
- Suite completa: falhas pré-existentes em e2e (precisam Playwright), integration (precisam Supabase local), `dompurify missing` no build (já documentado em 2026-04-23 copilot fix) — nenhuma introduzida por este fix.

## Pendências operacionais

1. **Aplicar em dev** (`bcfadphgsibjzivtbjvc`) a migration `20260423120000` e rodar `SELECT * FROM v_pipe_responsibility_drift LIMIT 100` para confirmar drift zero.
2. **Rodar o script de diagnóstico em prod** para Weder / Vagner / Mateus — preencher relatório por usuário (causa raiz individual: só Vetor A, só Vetor B, ou ambos).
3. **Deploy** (após autorização CTO):
   - `supabase functions deploy get-member-permissions --project-ref jsjsmuncfkbsbzqzqhfq`
   - Aplicar migration `20260423120000` em prod
   - Build do front → EasyPanel
4. **Follow-up PR** (Vetor C): `has_feature_permission_in_org(feature_key, organization_id)` + atualização das RLS de `leads`/`pipe_*` para passar `organization_id` da row. Sem isso, usuário multi-org com `leads.view_all=true` em org secundária continua vendo rows da errada. Prioridade alta depois que o incidente atual estiver resolvido.
5. Higienização recomendada (**fora do escopo**, documentado no relatório do Explore):
   - `save-member-permissions`, `send-meta-message`, `campaign-rule-dispatch` → adotar `requireOrganization:true`.

## Follow-up / Dívida técnica

Ver `.specs/features/funis-access-multi-org-rls/` (se criado) para ADR do Vetor C e decomposição futura.

## Referências

- Diagnóstico: [tests/sql/diagnose_funis_access_multi_org.sql](../../../../tests/sql/diagnose_funis_access_multi_org.sql)
- Migration precursora: [20260417110000_fix_pipe_closer_sdr_sync.sql](../../../../supabase/migrations/20260417110000_fix_pipe_closer_sdr_sync.sql)
- Migration deste fix: [20260423120000_verify_pipe_sync_and_backfill.sql](../../../../supabase/migrations/20260423120000_verify_pipe_sync_and_backfill.sql)
- Test SQL RLS ponta-a-ponta: [tests/sql/validate_pipe_closer_rls.sql](../../../../tests/sql/validate_pipe_closer_rls.sql)
