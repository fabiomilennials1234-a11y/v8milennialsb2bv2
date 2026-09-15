# Correções de atribuição, API e agenda — 15/09/2026

## Diagnóstico e escopo

- Atribuição (a68ac61b, 4801383c): o card unificado projetava `responsible/closer/sdr` como pré-venda. O detalhe usa `pre_sale_responsible/sale_responsible`. O RPC já retorna os dois papéis canônicos. Corrigida somente a projeção do card, inclusive remoção de atribuição e avatar por papel. Sem atualização de dados legados.
- API Nicoladeli (537a2520): `created_at` já estava na resposta, mas o handler ignorava `created_from/created_to`, suportados pelo RPC em produção. Agora valida e encaminha os limites; intervalo invertido/inválido retorna 422. Limites inclusivos e data sem hora significa 00:00 UTC. O cursor continua por última atividade. Não foi validado o cliente externo Nicoladeli.
- Agenda (a5ac6f69): três reuniões de setembro falhavam com SQLSTATE 23514 após movimentação real do negócio entre funis. A reunião mantém o funil histórico, enquanto a posição aponta ao atual. A validação passa a aceitar essa diferença somente quando o vínculo da reunião não muda. Organização, lead e vínculo de negócio continuam validados em toda escrita. Nenhuma policy ou permissão foi ampliada.

## Verificação

- Regressões de card/API executadas antes da correção e reproduziram os defeitos.
- 22 testes Vitest focados e 25 testes Deno da rota passaram.
- Teste PostgreSQL/PGlite executa as funções reais: reproduz a falha anterior, aplica a migration, marca/troca/remove resultado sem duplicar eventos, rejeita vínculo novo inválido e referência alheia, confere grants e executa rollback.
- Preflight no banco real, com `SET LOCAL ROLE authenticated` e identidade de cada um dos dois SDRs: 54 reuniões atualizadas por SDR, em transações integralmente revertidas. Antes da correção, 51 passavam e três falhavam. Teste negativo confirmou inacessibilidade de reuniões de outras organizações.
- Rollback da função executado no preflight: restaurou a rejeição anterior; transação externa reverteu todas as alterações.
- Não foi criada branch Supabase paga. Desvio do QA em preview: teste SQL local com fixtures mínimas e preflight transacional no schema real substituíram o ambiente indisponível; não equivalem a E2E no navegador.

## Segurança e publicação

Migration `20271021000012_meeting_historical_pipeline.sql`: somente substituição de função interna existente; `SECURITY DEFINER` com search_path fixo e EXECUTE revogado de PUBLIC, anon e authenticated. Sem backfill, alteração de RLS ou reprodução de workflows após commit. Arquivo de rollback acompanha a migration.

Frontend exige publicação da imagem após merge. A rota `api` exige deploy da Edge Function e a agenda exige aplicar a migration. Não encerrar chamados apenas por merge sem confirmar as três partes.
