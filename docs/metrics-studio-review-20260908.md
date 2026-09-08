# Revisão do PR #2040 — 2026-09-08

## Parecer: merge e produção bloqueados

Autorização do CTO para revisar, testar e mergear recebida nesta sessão.
Nenhuma escrita em produção, deploy ou merge foi realizado nesta revisão.

## Correções revisadas e verificadas

- Releitura atrasada podia substituir o layout local: regressão reproduzida
  antes da correção e aprovada depois, com cancelamento de leitura e proteção
  do rascunho durante debounce, escrita e retry.
- IDs de cards podiam se repetir após excluir e reabrir o painel: regressão
  reproduzida e corrigida sem alterar IDs existentes.
- Menu de abas disponível a administradores fora do modo de edição;
  exclusão exige confirmação. Card de métrica indisponível permanece visível.
- 282 testes focados passaram antes da última correção de IDs; os 15 testes
  dos hooks passaram novamente após essa correção. Seis testes do preparador
  de fixtures CI passaram. Não equivale a aprovação da suíte completa.
- CI do commit a24582ab: lint/build/tipos e testes Deno aprovados.

## Bloqueios reproduzidos

Execução: https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/actions/runs/34263706492

1. RLS, integração e E2E não chegam aos testes: o bootstrap para em
   `20271008000000_leitores_saem_dos_espelhos.sql`, preflight da função
   `get_analytics_utm_metrics(uuid,date,date,uuid,text,text,text,text)`.
   Hash esperado `d428c3fd36eed8f61f53c40348921f6b`, encontrado
   `7d90c3bb0605f2ac3eaeb98d7eb58345`.
   A migration anterior `20270925000000_aposenta_calor_e_rating.sql` altera
   essa função e remove rating. Consulta READ ONLY do ledger de produção
   confirma que essa retirada NÃO foi aplicada, enquanto as migrations
   `20271008000000` e `20271015000000` já foram. `leads.rating` ainda existe
   em produção e as funções UTM/próximas ações ainda o referenciam.
   Reconciliar essa cadeia exige revisão própria; não editar migrations
   aplicadas, desativar hashes nem restaurar corpos incompatíveis para obter
   CI verde. Nunca aplicar todo o backlog via db push.
2. A suíte unitária completa confirma seis falhas em
   `tests/unit/recriar-etapa-excluida.test.ts`, ramo custom. Reprodução local:
   `supabase.rpc is not a function` em `custom-pipeline-rpc.ts:26`.
   O mock de escrita direta não acompanha a chamada RPC atual. Não foram
   desativados testes nem relaxado o baseline.

O primeiro bloqueio de bootstrap (backup histórico exigia linhas em banco
vazio) foi resolvido com dados exclusivamente sintéticos no checkout do CI.
A execução acima passou por esse ponto sem modificar a migration original.

## Preservação de dados: preparado, ainda não validado em banco

O workflow contém ensaio com organizações sintéticas, backup privado,
semeadura repetida para testar idempotência, restauração exata de um painel
e testes positivos/negativos de permissões. O bootstrap bloqueado impede sua
execução. Os scripts de backup e seed não estão liberados para produção até
esse ensaio passar. Procedimento: `docs/metrics-studio-rollout.md`.

O incidente específico de desaparecimento em produção ainda não teve sua
causa comprovada; faltam organização, horário e evidência de rede. As duas
regressões corrigidas são causas possíveis reproduzidas no código, não prova
de que explicam todos os relatos de produção.

Nenhuma nova branch Supabase foi criada. A branch de outra tarefa,
`codex-condicional-20260907`, continua vinculada ao PR aberto #2038 e não foi
excluída sem comprovação de desuso.

## Continuação autorizada pelo CTO

- A proposta de rating foi movida integralmente (rename 100%) para
  `supabase/proposals/`, com plano de retomada documentado. Isto reconcilia
  o bootstrap com a ausência comprovada desse apply em produção; não simula
  sua aplicação no ledger nem muda os leitores já aplicados. O ensaio antigo
  aponta para o novo local e continua pendente de revalidação.
- Mock de `recriar-etapa-excluida` atualizado para a RPC efetivamente usada,
  mantendo estado e verificação de unicidade. Os 14 testes passaram.
- Nova rodada local: 287 testes aprovados em 31 arquivos, incluindo analytics,
  etapas e proteção do limite entre propostas e migrations.
- Rollback DDL de templates agora preserva TODAS as abas, inclusive templates
  intocados; ensaio executável de rollback/reapply adicionado ao CI.
- CI e rollout ainda aguardam validação; esta seção não libera o merge.
