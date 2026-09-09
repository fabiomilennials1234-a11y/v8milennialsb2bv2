---
type: changelog
title: Oráculo — fundação e contrato frontend
status: in-progress
created: 2026-09-08
tags: [oraculo, copilot, tdd]
---

# Oráculo — fundação e contrato frontend

Data: 2026-09-08. SCRUM-587 / SCRUM-594. Branch `codex/oraculo-fundacao-tdd`.

Correções: isolamento entre organizações e usuários, plano contratado, teto de ferramentas inválidas, persistência atômica, memória acumulada e telemetria. RPC de gravação usa lock e comparação da versão; conflito definitivo `PT409` após ensaio real revelar timeout com `40001`.

Frontend envia organização selecionada, particiona histórico/cache, preserva histórico ao continuar e ignora respostas atrasadas após trocar conversa. Carregamento e erro de histórico bloqueiam envio até resolução.

Validação: 860 testes backend, 10 frontend, 8 PostgREST/Auth reais. Branches QA removidas; produção não alterada. Replay completo da main bloqueado por preflight herdado SCRUM-639; alvo do QA descrito em `.specs/oraculo/FUNDACAO-TDD.md`. Smoke Chrome com Auth/PostgREST/edge/OpenRouter reais passou; login por formulário e shell global fora do harness. Gates gerais de CI e revisão de drift permanecem pendentes. Aplicar ambas migrations do Oráculo antes de implantar edge function.


## Continuação do CI — 2026-09-09

Run `34275901570` confirmou seis falhas de `recriar-etapa-excluida.test.ts`: mock do SDK não implementava a RPC atual (`supabase.rpc is not a function`). Substituído por fixture HTTP externa, usando SDK real; mesmos 14 casos passaram, contra 6 falhas/8 passes antes. Nenhuma baseline alterada.

Bootstrap dos três jobs de banco agora prepara projeto temporário `torque_ci`, somente no runner GitHub, aplica migrations anteriores a 20270925, insere um lead e uma entrada sintéticos com rating/calor e aplica todas as restantes. SQL das migrations preservado; backup vazio continua sendo erro. Seed automático desabilitado; E2E faz seed explícito com ON_ERROR_STOP. Cleanup executa mesmo quando o replay falha.

Revisões Standards e Spec sem achados novos. ESLint do teste e sintaxe shell passaram; script recusou execução fora de GitHub Actions. Execução real do novo bootstrap ainda pendente. O conflito entre aposentadoria de rating e funções posteriores de 20271008 permanece aberto: essas funções também reintroduzem referências ao campo removido. Não é seguro resolver isso alterando hashes ou simulando aplicação no ledger. CI completo não está verde.


### Main atualizada elimina necessidade do bootstrap intermediário

Após fetch em 2026-09-09, main `e432883a` já incorporava `90a6702f`: aposentadoria de rating era proposta não implantada e foi movida para `supabase/proposals/`. Preservado esse tratamento já revisado na main. Removidos os scripts intermediários de fixture/bootstrap deste PR; workflow volta ao replay normal com os novos checks da main. Mantidos SDK real no teste de etapas e ON_ERROR_STOP no seed E2E. Merge incorpora também fixtures canônicas e correções SQL da main. Novo CI precisa comprovar cadeia completa; registro anterior descreve estado antes desse merge.


### Evidência do CI após merge (código 0d0eff37)

Run `34362959348`: Lint & Build, Edge Functions, CodeQL, vault e secret scan aprovados. RLS aplicou as duas migrations novas do Oráculo e aprovou 2.074 testes em 97 arquivos. Duas suítes de funcionalidades futuras continuam pendentes pelo contrato já existente da main.

Integração: 474 passaram, 34 falharam e 102 foram pulados. Comparação com job `102456019954` do PR #2040 (run `34348032335`, já incorporado à main): conjunto de 42 entradas FAIL (inclui hooks de setup/teardown) é idêntico; nenhum nome novo de falha. Totais também idênticos: 18 arquivos falhando, 28 passando e 7 pulados. Há contratos antigos pipe_*, fixtures sem slug/seats, expectativas antigas de master e isolamento, além de efeito entre fixtures. Não alteramos permissões nem suprimimos esses testes para liberar o Oráculo.

Build local passou; frontend Oráculo 10/10, HTTP Oráculo 19/19, etapas/fixtures 22/22. Deno local com --frozen expôs alias @2 divergente do lock da main; teste normal com lock temporário externo passou 19/19 no SDK atual, sem alteração de dependências no repo. Unitários gerais e E2E ainda em execução ao registrar; E2E do PR #2040 também falhou e levou 50m46s. PR permanece rascunho e produção intacta.
