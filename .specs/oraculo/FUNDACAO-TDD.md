# Oráculo — correções da fundação com TDD

Data: 2026-09-08
Branch: `codex/oraculo-fundacao-tdd`
Base auditada: `55673f90` (`origin/main`).
Estado: fronteiras confirmadas pelo CTO ("CONFIRMO"). Correções locais implementadas com TDD; validação SQL/RLS real concluída na branch temporária; publicação pendente.

## Escopo desta entrega

Corrigir cinco falhas verificadas na fundação da SCRUM-594 antes de ampliar o acesso pelo PR #1908: isolamento das conversas, contratação da feature, teto do laço, persistência e memória acumulada.

Não inclui implementar as ondas seguintes, mesclar os PRs existentes ou publicar em produção.

## Fronteiras confirmadas

### 1. API HTTP de turnos — `POST /functions/v1/oraculo-turno`

Exercitar o caminho de produção, incluindo autenticação, autorização, persistência e adaptador do modelo. Não substituir módulos internos por mocks.

- A mesma pessoa consegue continuar sua conversa na organização correta.
- A mesma pessoa não consegue continuar uma conversa de outra organização, inclusive após revogação de vínculo.
- Outra pessoa não consegue usar a conversa alheia.
- Organização sem direito ao Oráculo recebe recusa antes de consumir IA; organização habilitada consegue conversar.
- Usuário desativado é recusado.
- Falha ao persistir o turno não é apresentada como resposta bem-sucedida.
- Solicitações repetidas de ferramentas inexistentes terminam com limite explícito e resposta utilizável.

### 2. API de histórico consumida pelo aplicativo — PostgREST autenticado

Ler conversas e turnos pela mesma interface usada pelo cliente, com identidades de teste e banco de validação isolado.

- Um turno confirmado pode ser recuperado.
- Histórico da outra organização ou de outro usuário não fica disponível por troca de identificador.
- Revogação do acesso impede novas leituras de conteúdo protegido.

Asserções observam respostas da API. Consultas SQL diretas servem para preparar fixtures, não para substituir a comprovação do comportamento público.

### 3. Fronteira externa do modelo — API HTTP OpenRouter

Usar servidor externo simulado com respostas determinísticas, sem chamadas pagas. Manter laço, montagem de contexto e adaptador reais.

- Informação antiga continua no contexto depois de ultrapassar a janela de mensagens recentes e reabrir a conversa.
- Falha da API do modelo não produz falso sucesso nem resumo que destrua a memória anterior.
- Chamadas inválidas persistentes têm orçamento limitado e encerram o turno.

Inspecionar o pedido recebido pelo servidor simulado é observar o contrato externo; não verificar chamadas a helpers privados.

## Sequência de execução

Execução autorizada: uma fatia por ciclo: um teste que falha pelo defeito observado, implementação mínima, teste verde. Começar pelo isolamento, depois contratação, teto, persistência e memória longa. Acrescentar controles positivos e negativos ao longo dos ciclos, sem escrever toda a suíte antecipadamente.

Banco de validação: branch efêmera conforme runbook do projeto, com fixtures sintéticas e encerramento ao terminar. Não usar produção para fixtures ou testes de escrita. Falhas externas podem ser simuladas na fronteira HTTP do banco/modelo; módulos internos permanecem reais.

Validação final: testes da área, verificação de tipos, gates de delta aplicáveis e revisão das mudanças sensíveis. Registrar evidência vermelho/verde e limitações reais. Publicação em produção continua fora desta entrega.

## Referências consultadas

- Skill `mattpocock-skills:tdd`, incluindo `tests.md` e `mocking.md`.
- `CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, `supabase/functions/_shared/CLAUDE.md`.
- `.specs/project/runbook-validacao-local.md`.
- ADR-0032 e ADR-0033, lidos no commit `ef355479`; esses arquivos não estão presentes na base auditada.
- Auditoria de SCRUM-587 e seus tickets, incluindo comentários de implantação da SCRUM-594.

## Implementação e evidência — 2026-09-08

- Isolamento: busca de conversa e histórico exige organização e proprietário. Teste reproduziu vazamento entre organizações antes da correção; controle positivo, outro usuário e revogação cobertos.
- Contratação: entrada real consulta o plano antes de consumir IA. Teste passou de HTTP 200 indevido para 403.
- Orçamento: seis tentativas de ferramentas, incluindo inválidas, seguidas de finalização sem ferramentas. Controles cobrem seis consultas válidas e bloqueio da sétima.
- Persistência: erros deixam de retornar sucesso. Nova RPC `oraculo_save_turn` grava pergunta, resposta, resumo e metadados numa transação; bloqueio de linha e comparação de versão recusam resposta concorrente com HTTP 409.
- Memória: consolidação antes de descartar mensagens, resumo acumulado enviado ao modelo e salvo com o turno. Conversa de 12 turnos preserva informação antiga após reabertura. Falha do resumo preserva estado anterior.
- Falhas externas: indisponibilidade do modelo, conversa, histórico, quota ou limite da organização retorna erro antes de falso sucesso. Testes reproduziram HTTP 200 antes das correções.
- Telemetria: tokens e latência incluem consolidação da memória. Teste com espera externa de 100 ms falhou antes da correção e passou depois.

Os 19 testes HTTP carregam o entrypoint real e exercitam Request/Response; substituem apenas hospedagem (`Deno.serve`) e transporte externo (`fetch`). Auth, SDK, store e adaptador de IA permanecem reais. O PostgREST é simulado nesta suíte: ela comprova contrato e propagação de erros, **não comprova execução SQL, RLS ou atomicidade real**.

## Checks locais concluídos

- Backend completo: **860 testes passaram**, zero falhas, incluindo 19 testes HTTP novos.
- `deno check` do entrypoint e testes: passou.
- ESLint da área alterada e `git diff --check`: passaram.
- Build de produção local: passou.
- Typecheck ratchet: falhas herdadas, conforme comparação com a base abaixo.

## QA real concluído — 2026-09-08

Exceção à regra de uma branch autorizada pelo CTO nesta sessão. Criada `codex-oraculo-qa-20260908` (`drvnslqdkkobgwvshtej`), sem dados de produção. **Removida ao terminar**, credenciais temporárias apagadas. Branch da outra tarefa preservada. Revisão pediu controle adicional de continuação: segundo ensaio em `codex-oraculo-qa-final-20260908` (`bxtclxlvdbbnkqwpfmkz`), também removida ao terminar. Suíte final passou 8/8 em 4,15 s.

**8/8 testes passaram** em `tests/remote/oraculo-api.test.ts`, usando Auth Admin para usuários sintéticos, login real e PostgREST real:

- anon e authenticated (incluindo dono) não executam a RPC;
- service role com organização/proprietário trocado não grava;
- falha na segunda linha desfaz pergunta;
- trigger de QA falhando no UPDATE, após INSERT das duas linhas, desfaz turno e memória;
- dois pedidos HTTP concorrentes confirmam somente um par, outro recebe HTTP 409; metadados e ordem preservados;
- continuação com timestamp retornado pelo PostgREST confirma quatro mensagens e resumo atualizado, sem perder precisão;
- outra pessoa não lê conversa/turnos, dono não fabrica resposta diretamente;
- revogação do vínculo A remove acesso em A e preserva acesso legítimo em B.

**Defeito descoberto no QA:** `40001` não concluiu via PostgREST antes de 20 s, inclusive com HTTP direto. Nova migration `20271019000001_oraculo_conflito_http.sql` usa `PT409`, conflito definitivo. Mesmo teste passou em 142 ms. A primeira migration foi preservada porque já havia sido aplicada. Store aceita os dois códigos durante a transição.

### Limite do ambiente

Replay começou com banco vazio e 3 entradas fantasma no ledger, corrigidas somente após confirmar zero tabelas públicas. Migration de aposentadoria de calor exige backup não vazio; fixtures sintéticas mínimas permitiram aplicá-la sem alterar arquivo.

Cadeia aplicou até `20271007000030`. Migration `20271008000000_leitores_saem_dos_espelhos.sql` recusou preflight de `get_analytics_utm_metrics`: hash esperado `d428c3fd36eed8f61f53c40348921f6b`, atual `7d90c3bb0605f2ac3eaeb98d7eb58345`. Guarda preservada. As duas migrations do Oráculo foram aplicadas via `db-push-branch.sh` em snapshot de validação contendo apenas cadeia já aplicada e as duas novas. Não houve reparo falso de migrations posteriores. No segundo ensaio, replay também trouxe `20260727150203_tv_s2_stage_label_scope`; seu conteúdo foi recuperado do ledger para o snapshot temporário, preservando registro real sem modificar repo.

Resultado comprova SQL/RLS do Oráculo nesse schema, **não replay completo da main nem compatibilidade garantida com drift de produção**. Outro defeito herdado observado: exclusão de organização aciona fila com FK inválida; teardown removeu branch inteira e todas as fixtures.

### Reproduzir

1. Criar branch sem dados pelo runbook, preparar schema e aplicar ambas as migrations do Oráculo pela guarda.
2. Instalar `supabase/qa-seed/oraculo-rollback.sql` com `scripts/seed-branch.mjs` somente na branch descartável.
3. Exportar `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY` e `TEST_SUPABASE_SERVICE_ROLE_KEY` da branch; executar `npx vitest run tests/remote/oraculo-api.test.ts --reporter=verbose`.
4. Remover branch e credenciais. A suíte remove usuários/conversas; organizações sintéticas ficam até teardown da branch devido ao trigger herdado.

### Publicação pendente

Revisar PR; conferir drift do ambiente alvo; aplicar ambas as migrations antes de publicar `oraculo-turno`. A função depende da RPC nova. Produção continua exigindo autorização específica. Contrato frontend corrigido e validado pelos testes HTTP abaixo; Smoke da página autenticada com serviços implantados e modelo real concluído; gates de CI e revisão de drift permanecem pendentes.

## Limitações e continuidade do épico

- Frontend corrigido: organização vem do contexto selecionado e servidor valida vínculo. Lista/histórico usam filtros de dono+organização e cache separado. Troca de identidade/organização remonta tela e limpa conversa local.
- Conversas legadas com mais de 20 mensagens sem resumo não recuperam automaticamente mensagens anteriores à janela. Migração/reconsolidação histórica exige decisão própria.
- PRs #1908 e #1914 e SCRUM-597 a SCRUM-606 continuam fora desta entrega. Fundação corrigida não significa épico concluído.
- Typecheck ratchet falha com os mesmos 62 erros nos logs da base `55673f90` e desta branch (comparação integral sem diferenças). Nenhuma baseline foi regenerada.

## Frontend — 2026-09-08

10 testes passaram, com React/QueryClient e SDK reais e transporte HTTP externo simulado. Ciclos vermelho→verde cobriram organização no body, ausência de organização, mensagens 403/409 (429 preservado), resposta atrasada após trocar conversa, continuidade sem ocultar mensagens recuperadas, filtros/cache por usuário+organização, invalidação de histórico após confirmação e GET atrasado bloqueando envio.

Página bloqueia envio e sugestões enquanto histórico da conversa existente carrega ou falha; erro apresenta botão de retry. Resposta confirmada invalida lista e turnos, inclusive quando usuário já abriu outra conversa. Build e ESLint passaram. Typecheck mantém erros herdados da base, sem regenerar baseline.

Os testes comprovam contrato de rede e comportamento dos hooks. Smoke de navegador com edge implantada e IA real concluído abaixo. PR permanece em rascunho pelos gates de CI e revisão de drift. Não mesclar automaticamente.

## Ajuste de CI

Versões 20271018000000/001 colidiram com migrations novas da main após abertura do PR. Renumeradas para 20271019000000/001, SQL inalterado. Aplicações anteriores existiram somente nas branches QA já removidas; nenhuma versão do Oráculo aplicada em produção.

## Smoke integrado real — 2026-09-08

**Passou no Chrome em 11,7 s** (`tests/browser/oraculo/smoke.spec.ts`): página real + AuthProvider/useOrganization + SDK, sessão real obtida pela Auth API, PostgREST real, `oraculo-turno` implantada e OpenRouter real. Chave existente `Openrouter_Key` mapeada para secret `OPENROUTER_API_KEY` somente na branch QA. Nenhuma credencial incluída no repo.

Percurso: abrir conversa com informação sintética → perguntar → HTTP 200 com resposta não vazia do modelo → recarregar página e recuperar pergunta/resposta → trocar organização e não exibir histórico anterior → trocar plano de fixture por plano cadastrado sem Oráculo → recusa visível. O harness monta a página diretamente; não cobre login por formulário nem shell global do aplicativo.

Branch `codex-oraculo-smoke-20260908` (`oylwwsandispchczguhl`) removida ao terminar; sessão e credenciais temporárias apagadas. Produção intacta. Mesmo limite de schema do QA anterior: cadeia até20271007000030 mais migrations do Oráculo. Versões equivalentes reaplicadas pelo provisionamento foram preservadas pelos registros originais no snapshot, sem alterar ledger para simular aplicação.

Para repetir: preparar branch descartável, aplicar migrations e implantar oraculo-turno; configurar secret de modelo nela. Exportar TEST_SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY e ORACULO_SMOKE_SESSION_FILE fora do repo. Rodar `node tests/browser/oraculo/seed.mjs`, depois `npx playwright test --config tests/browser/oraculo/playwright.config.ts`. Chrome instalado é utilizado. Remover branch e arquivos de credenciais ao terminar.

## CI restante

Após renumeração, Lint & Build, CodeQL, secret scan e Edge Function Tests passaram. Vault: frontmatter corrigido; índice MOC regenerado. Integration, RLS e E2E gerais falham antes dos testes no mesmo bootstrap: `20270925000000_aposenta_calor_e_rating.sql`, `BACKUP rating incompleto: 0 copiadas vs 0 na origem`. Não enfraquecemos essa guarda nem marcamos esses jobs como verdes. Resolver bootstrap geral/replay antes do merge. Unit geral ainda estava em execução ao registrar este resultado.


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
