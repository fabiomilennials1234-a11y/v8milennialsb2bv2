# Concessão de dados e rollback — entrega parcial 02

## Contrato

- Concessão pertence ao workflow e à organização resolvida no servidor. Não recebe organização no RPC.
- Escopo atual: `organization_leads`, apenas `lead.name`. Inclui todos os leads vivos daquela organização quando o runtime autorizado for implementado. Nenhum outro campo é concedido implicitamente.
- Lista vazia revoga; revisão monotônica protege alterações concorrentes. Revisão desatualizada retorna `PT409`/HTTP 409, sem retry de falha de serialização.
- Autoridade usa `get_my_admin_organization_ids()`, a fronteira atual do produto: administradores ativos e autoridade administrativa de gestor vinculada, excluindo organizações bloqueadas. O botão do editor usa o papel administrativo resolvido pela sessão.
- Aprovação não depende de `workflows.created_by`. Identidade de quem aprovou é auditoria, com `ON DELETE SET NULL`; não é credencial de execução.
- Membro comum não aprova nem lê registros de concessão. `anon` e `service_role` não executam o RPC; nenhuma escrita direta na tabela é concedida a eles ou a `authenticated`. Serviço recebe apenas SELECT para futura avaliação, que ainda precisa verificar o escopo.
- **Ainda não certificado:** publicação e execução versionada. Avaliador organizacional já consome concessão via leitura atômica protegida. O executor legado rejeita definições guiadas antes da primeira ação. Autorizar acesso ainda não libera execução guiada.

## Aplicação no preview

Alvo desta sessão: `mkpjjtwjyvgabavnxqgp`, não produção. Aplicadas em ordem:

1. `20271017000000_workflow_data_grants.sql`
2. `20271017000001_workflow_grant_revision_conflict.sql`
3. `20271017000002_guided_condition_authorized_read.sql`
4. `20271017000003_guided_workflow_drafts.sql`
5. `20271017000004_guided_workflow_master_authorization.sql`
6. `20271017000005_create_guided_workflow_draft.sql`
7. `20271017000006_guided_workflow_draft_settings.sql`
8. `20271017000007_create_guided_workflow_draft_settings.sql`

A segunda é correção aditiva: a primeira migração aplicada permanece imutável. O teste real revelou timeout na resposta de revisão antiga com o SQLSTATE de serialização original.

## Reverter

Interromper novas execuções guiadas antes de reverter. Nesta etapa elas já estão bloqueadas pelo executor.

1. Aplicar rollback de `20271017000007_create_guided_workflow_draft_settings.sql`.
2. Aplicar rollback de `20271017000006_guided_workflow_draft_settings.sql`.
3. Aplicar rollback de `20271017000005_create_guided_workflow_draft.sql`.
4. Aplicar rollback de `20271017000004_guided_workflow_master_authorization.sql`.
5. Aplicar rollback de `20271017000003_guided_workflow_drafts.sql`.
6. Aplicar rollback de `20271017000002_guided_condition_authorized_read.sql`.
7. Aplicar rollback de `20271017000001_workflow_grant_revision_conflict.sql`.
8. Aplicar rollback de `20271017000000_workflow_data_grants.sql`.

Rollback completo remove RPC/policy e revoga permissões, preservando tabela e histórico. Não desabilita RLS, não concede acesso amplo e não altera workflows legados. Reaplicar as oito migrações na ordem original restaura a funcionalidade. Não reaplicar apenas a primeira em uma instalação que já recebeu a correção de conflitos.

Sétima e oitava adicionam configurações do rascunho ao save/criação atômicos. Rollback remove RPCs novas e mantém coluna `settings` e seus dados. Ensaio das oito migrations passou em 2026-09-08: regras, configurações, revisão e aprovação preservadas. Ambas RPCs `*_with_settings` foram verificadas no preview com anon=false, authenticated=true, service_role=false.

A sexta cria automação inativa e rascunho na mesma transação. Seu rollback remove apenas a RPC de criação, sem apagar dados. `create_guided_workflow_draft(uuid,uuid,text,jsonb)` conferida no preview: anon=false, authenticated=true, service_role=false. Ensaio das seis migrations passou em 2026-09-08.

A quinta permite administração guiada por master pleno ativo, com `permissions.all` booleano verdadeiro. Preserva helper existente para administradores e gestores. Não amplia permissões de outros módulos. Seu rollback isolado restaura autorização anterior e mantém aprovações e rascunhos. Helper `can_administer_guided_workflow(uuid)` verificado no preview: anon=false, authenticated=true, service_role=false. Ensaio das cinco migrações passou em 2026-09-08.

## Prova repetível

`node scripts/check-guided-grant-rollback.mjs <preview-ref>` executa os arquivos reais em transação no preview, cria aprovação sintética na revisão 7 e rascunho na revisão 11, reverte em ordem inversa e reaplica. Verifica inacessibilidade após rollback, preservação da aprovação, grants finais e definição da função restaurada. O ROLLBACK final remove fixtures e devolve o ambiente ao estado inicial do ensaio.

`node scripts/test-guided-preview.mjs <preview-ref>` testa aprovação, revogação, concorrência, escopo, RLS e teste pessoal usando Auth/PostgREST reais. Credenciais ficam apenas em memória.

Verificar no alvo os privilégios de `set_workflow_data_grant(uuid,text[],integer)`: anon=false, authenticated=true, service_role=false; INSERT/UPDATE direto por authenticated=false. Migração aplicada não substitui essa verificação.

### Publication migration 20271017000008

Applied/registered only on preview mkpjjtwjyvgabavnxqgp. Forward adds workflow_guided_versions and workflow_guided_publications plus service-only finalize_guided_workflow_publication. Authenticated clients may read under administration RLS; service/authenticated clients have no direct INSERT/UPDATE/DELETE. Finalizer EXECUTE is service_role only, checks verified actor authority, exact draft revision/content and current grant under locks.

Rollback file: supabase/migrations/rollback/20271017000008_guided_workflow_publication.sql. Drops finalizer and policies and revokes table access; preserves version records and selected pointer. Roll back 08 before 07..00 because policies depend on the administration helper. Reapply in ascending order. Expanded scripts/check-guided-grant-rollback.mjs rehearsed all nine migrations in one preview transaction and verified preservation plus effective grants. This is schema rollback evidence; runtime publication is still gated and production deployment remains unauthorized.

### Execution pin migration 20271017000009

Preview-only additive guided_version_id and composite version FK on workflow_executions. BEFORE INSERT captures selected version under parent workflow lock, overriding caller-supplied pin; BEFORE UPDATE prevents pin changes and reassignment of pinned workflow/org. Function is SECURITY DEFINER with public search_path; EXECUTE revoked from PUBLIC, anon, authenticated, service_role (trigger invocation only). No existing execution backfill.

Rollback preserves pins/FK and UPDATE guard, disables automatic INSERT capture. Stop guided admission before reverting; keep version-aware executor until pinned runs drain. Roll back 09 before 08..00, reapply ascending. scripts/check-guided-grant-rollback.mjs now rehearses ten migrations and verifies retained execution pin and effective function grants inside a rolled-back preview transaction. Runtime gate is still closed at this checkpoint.

### Discovery migration 20271017000010

Preview applied/registered. AFTER INSERT/UPDATE of selected version synchronizes published name and trigger type/config to the existing workflow discovery surface. Same transaction as version selection; no activation, legacy-definition overwrite or data backfill. Trigger function direct EXECUTE denied to PUBLIC/anon/authenticated/service_role, search_path fixed.

Rollback removes only sync trigger/function and keeps last published metadata, version history and pins. Stop guided admission first. Reverse order 10..00; ascending reapply. Eleven-file transactional rehearsal verifies retained discovery metadata, versions, pins, drafts, grants and restored restricted privileges. Full producer discovery and activation remain unfinished.

### Activation migration 20271017000011

Preview applied/registered. Authenticated-only set_guided_workflow_active derives org, checks current admin and selected version under lock. Trigger-only guard_guided_workflow_activation checks current publication and grant on is_active writes, including direct API mutation. Guard direct EXECUTE denied to all application roles; activation RPC denied to anon/service/PUBLIC and granted authenticated. Functions pin search_path.

Rollback keeps state/history and replaces guard with unconditional rejection of guided activation; deactivation stays possible. Drops activation RPC. Stop admission before rollback; do not clear pins or pretend old definitions can be reconstructed. Twelve-file rehearsal proved rollback denies activation and reapply restores privileges without losing synthetic data.

### Company authorization migration 20271017000012

Applied and registered only on preview. Expands explicit field allowlists from name to name/company without updating existing approvals. New service-only read_guided_condition_lead_fields validates requested fields, checks workflow-derived organization and the current grant under SHARE locks, and returns only those fields as field_values. Caller/anon EXECUTE denied; service allowed and effective grants verified live. Setter retains current administrator/CAS authorization; finalizer permits company only with its current grant.

Rollback restores name-only setter/finalizer and disables the new reader, preserving stored approvals (including company), drafts, versions and execution pins. Expanded storage CHECK remains intentionally to retain that history; it is not an access grant. Stop guided admission first; company executions must stop rather than fall back to another source. Revocation through the restored setter remains possible. Thirteen-migration reverse/forward rehearsal passed with a synthetic name+company grant/version retained and reader grants denied after rollback/restored after reapply. No data backfill and no production apply.

### Contact authorization migration 20271017000013

Preview only, applied and registered. Explicit email/phone scopes added to grant writer, finalizer and exact-projection reader; existing approvals unchanged. Effective reader grants checked live: anon/authenticated denied, service only. New scalar fields reuse current per-field grant checks and do not normalize stored phone/email values.

Rollback 13 restores name/company-only functions while retaining the wider storage constraint and contact approval/version history. Stop admission first. Full recovery after reverse rollback uses forward 00..11 then 13: 13 contains and supersedes all definitions from 12. Do not reapply 12's narrower CHECK over retained contact approvals; it would fail validation. Fresh installation still follows normal migration order. Updated rehearsal successfully rolled back all 14 files and restored the superset using this sequence, preserving synthetic grants/versions containing all four fields, drafts, metadata and pins. No customer data transformed or deleted.

### Personal tag test migration 20271017000014

Preview only, applied/registered. test_guided_condition_tags is STABLE SECURITY INVOKER: one caller-visible snapshot checks lead access, every tag identity in the selected organization, then membership. It never substitutes an equal tag name for a missing ID. lead_tags has no organization_id column; its reads are constrained by the already-authorized lead and organization-filtered tag IDs. Effective EXECUTE: authenticated true, anon/service false.

Rollback drops only the personal test function; all tag and workflow data remain. Fifteen-migration reverse rollback/superset recovery rehearsal passed, including absence of this function after rollback and restored restricted grants after reapply. Contact-scope recovery still follows 00..11, 13 (superseding 12), then 14. This personal reader grants no organizational automation access to tags.

### Organization tag authorization migration 20271017000015

Applied/registered only on preview. Explicit lead.tags scope added without changing existing approval rows. read_guided_condition_data is service-only, validates the complete requested scope under workflow/grant locks, locks the selected lead and referenced tags, and projects current scalar values/membership together. Same-name foreign tags never replace identity. Effective EXECUTE checked live: anon/authenticated false; service true. Publication finalizer remains scalar-only until its separate reference-validation slice.

Rollback restores the previous scalar grant writer and drops the new data reader, preserving expanded CHECK and stored tag grants/versions/pins. Stop guided admission before rollback; there is no fallback to unrestricted reads. Full superset recovery now uses 00..11, then 15 (includes 13 and 12 definitions), plus 14 for the personal tag RPC. Do not reapply the narrower 12 or 13 storage constraints over preserved tag approval history. Fresh installation remains sequential. Rehearsal includes synthetic five-field history and checks removal/restoration of the new reader and its effective privileges.

### Tag publication migration 20271017000016

Applied/registered only on preview. The service-only finalizer checks every tag reference under catalogue SHARE locks and current workflow grant before inserting/selecting a version. References must belong to the same organization; matching names do not substitute IDs. Effective EXECUTE verified: anon/authenticated false, service true.

Rollback restores the prior scalar-only publication function without changing stored versions/selection or grants. Stop guided admission before rollback; preserved tag versions do not authorize unrestricted reads. Current full recovery sequence: 00..11, 15 (superset of 12/13), 14 (personal tag RPC), then 16. Fresh installation remains in normal numeric order. New rehearsal reverses 16 first, then 15..00 and restores the complete sequence while preserving synthetic five-field grants, versions and execution pins.

### Reference location migration 20271017000017

Applied/registered on preview only. The finalizer's existing reference validation now retains owning workflow node IDs and reports only invalid nodes in PT422 JSON details. This is diagnostic metadata from the editable persisted definition; no tag data or foreign identity is exposed. Effective grants unchanged and verified: anon/authenticated false, service true.

Rollback restores migration 16's validating finalizer without location details, retaining all versions, grants and execution pins. Recovery appends 17 after the existing 00..11 → 15 → 14 → 16 superset sequence; fresh installation remains numerical. Eighteen-file reverse rollback/recovery rehearsal passed. Deployment may safely encounter the older finalizer: API/editor retain an explicit reference error when details are absent.

### Numeric qualification score migration 20271017000018

Applied/registered on preview only. Adds explicit lead.qualification_score to the grant writer, scalar and mixed-tag readers, and publication finalizer. Numeric projection preserves zero/null and returns only requested fields. Existing grant rows are not broadened. Effective EXECUTE verified live for all four functions: readers/finalizer service-only; grant writer authenticated-only with business administration checks unchanged.

Rollback restores the exact previous writer/readers/finalizer while preserving wider storage CHECK, approval history, immutable versions and execution pins. Stop guided admission before rollback; numeric evaluation then fails closed. Nineteen-file reverse rollback/recovery rehearsal passed with synthetic six-field history. Full recovery now runs 00..11, 18 (supersedes 12/13/15/16/17), then 14 (personal tag RPC). Do not reapply earlier narrow constraints over retained score/tag approvals. Fresh installation remains numeric order. No production deployment.
