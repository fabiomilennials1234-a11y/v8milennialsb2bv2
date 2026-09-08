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

A segunda é correção aditiva: a primeira migração aplicada permanece imutável. O teste real revelou timeout na resposta de revisão antiga com o SQLSTATE de serialização original.

## Reverter

Interromper novas execuções guiadas antes de reverter. Nesta etapa elas já estão bloqueadas pelo executor.

1. Aplicar rollback de `20271017000003_guided_workflow_drafts.sql`.
2. Aplicar rollback de `20271017000002_guided_condition_authorized_read.sql`.
3. Aplicar rollback de `20271017000001_workflow_grant_revision_conflict.sql`.
4. Aplicar rollback de `20271017000000_workflow_data_grants.sql`.

Rollback completo remove RPC/policy e revoga permissões, preservando tabela e histórico. Não desabilita RLS, não concede acesso amplo e não altera workflows legados. Reaplicar as quatro migrações na ordem original restaura a funcionalidade. Não reaplicar apenas a primeira em uma instalação que já recebeu a correção de conflitos.

## Prova repetível

`node scripts/check-guided-grant-rollback.mjs <preview-ref>` executa os arquivos reais em transação no preview, cria aprovação sintética na revisão 7 e rascunho na revisão 11, reverte em ordem inversa e reaplica. Verifica inacessibilidade após rollback, preservação da aprovação, grants finais e definição da função restaurada. O ROLLBACK final remove fixtures e devolve o ambiente ao estado inicial do ensaio.

`node scripts/test-guided-preview.mjs <preview-ref>` testa aprovação, revogação, concorrência, escopo, RLS e teste pessoal usando Auth/PostgREST reais. Credenciais ficam apenas em memória.

Verificar no alvo os privilégios de `set_workflow_data_grant(uuid,text[],integer)`: anon=false, authenticated=true, service_role=false; INSERT/UPDATE direto por authenticated=false. Migração aplicada não substitui essa verificação.
