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
