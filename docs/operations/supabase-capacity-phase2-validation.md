# Validação — capacidade Supabase fase 2

Data: 2026-09-23. Base: `dcf94200677464ab8b11682468b219e14630ac6c` (main).
Mudanças em `codex/supabase-capacity-phase2`. Sem deploy backend ou troca de
rotas Uazapi durante validação. Flags de filtro/ingresso continuam OFF.

## Resultados

- 246 testes direcionados, 16 arquivos: frontend, provider, grupos, recibos,
  propostas, normalização, ingresso e interação com workflows.
- Integrações PGlite: SQL original, grants/RLS, tenant, lease/CAS, FIFO,
  orçamento, retry, rollback e harnesses isolados.
- Build frontend passou. TypeScript ratchet: zero erros introduzidos.
- Cache Deno frozen e typecheck de runtime/inbox/worker passaram.
- Revisão independente: frontend/auth; configuração Uazapi; SQL; extração do
  handler. Correções incluíram preservação de provisionamento incerto,
  isolamento de leitura, status monotônico e efeitos comerciais recuperáveis.

## Validação remota Supabase

Primeira preview `mnvjykkhlwlreooulkqo`: migration28 passou; conexão interrompida
na validação29, enquanto provisionamento ainda não estava estabilizado. Não
atribuir causa definitiva à conexão. Preview excluída e ausência confirmada.

Segunda preview `clkzsmmmzblmbpoykzkg`: esperado projeto ACTIVE_HEALTHY e fim da
fase de criação. Provisionamento de migrations manteve falha histórica do
baseline; testes usaram fixtures isoladas, não alegam validar a cadeia inteira.
Os três harnesses passaram pela API `apply_migration`:

- `build-group-policy-preview-validation.mjs`: política28, ativação por todas
  instâncias, tenant, leases incertos, ACL e rollback/reapply.
- `build-ingress-inbox-preview-validation.mjs`: fila29, permissões, ordem,
  falha/retry, retenção, cascata de exclusão intencional e orçamento. Fronteiras
  de quota usam contador sintético próximo ao limite; não é teste de carga.
- `build-workflow-admission-preview-validation.mjs`: guarda30, candidaturas
  stage_changed/deal_won/deal_lost, payload, autoria, ACL e rollback/reapply.

SQL usa schemas próprios e `ROLLBACK`. Auth/HTTP do teste de workflow são
simulados: nenhum envio externo. Consulta posterior confirmou ausência dos
schemas `group_policy_test`, `capacity_ingress_test`, `workflow_admission_test`.
Preview excluída; listagem confirmou ausência. Nenhum recurso temporário desta
fase permaneceu ativo.

## Dívida de checks preexistente

Suite ampla: 149 falhas toleradas pelo baseline e 16 apontadas fora dele.
As mesmas 16 foram reproduzidas no checkout limpo da base, com dependências
iguais. Não alteramos baseline Vitest para mascarar falhas.

ESLint: cinco assinaturas de aviso preexistentes, reproduzidas nos mesmos
arquivos de quotes na base limpa. O baseline mudou somente o caminho do
handler extraído (`index.ts` → `handler.ts`) e removeu assinatura antiga sem
ocorrência. Nenhum novo aviso foi incorporado.

Vault: 211 erros/77 avisos tanto na base limpa quanto nesta branch; novo registro
não acrescentou ocorrências. Scanner de segredos apontou arquivo operacional
preexistente `scripts/ops/repair-loofting-bulk-pipeline-move.sql:18`, byte a byte
igual à base. Não se declara scanner global verde nem se suprime apontamento.

GitHub Actions já estava impedido de iniciar por limite/pagamento da conta.
Verificar estado do PR; não apresentar jobs não executados como CI aprovado.

## Gates antes de ativação

O teste remoto valida SQL contra fixtures, não desempenho de produção, contrato
Uazapi, restart real do container ou experiência ponta a ponta. Antes de rotear:
provar separação de eventos, ACK202/retry, capacidade VPS, latência comercial,
processo único, recuperação após interrupção e rollback. Inbox inicial é para
canary (20 mil registros/64 MiB incluindo retenção), não ingresso completo.

Picos históricos 45/s e 317/min exigem pelo menos 90/s e 634/min em teste no
ambiente de destino, sem degradar serviços existentes. Nenhuma economia dessa
arquitetura foi contada como realizada; a meta de 1,4M ainda exige medição.
