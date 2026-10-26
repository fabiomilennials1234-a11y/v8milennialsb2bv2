# Diagnóstico da suíte — Meta produção

Runtime de comparação: Node 24.22.1, Vitest 4.1.0, dependências do package-lock, 6 workers. Base limpa: main 56d8753ca, checkout separado, mesmas dependências. Nenhum baseline foi regenerado.

## Resultado da investigação

A rodada anterior no Node 26 acusou 229 falhas fora do baseline. A amostra de VoiceCallButton falhava em localStorage.clear antes de exercitar o componente; desativar Web Storage experimental fez os 26 testes passarem. A repetição ampla no Node 26 caiu para 51 falhas fora do baseline.

Com o runtime Node 24 usado no CI, a main limpa teve 17.363 testes: 17.074 passaram, 128 falharam e 161 ficaram pendentes; seis arquivos também não coletaram por imports legados ausentes. Dessas 128 falhas, 50 estão fora do baseline registrado. Não tratar diferença entre execuções/runtimes como regressão sem comparação direta.

A primeira comparação da branch teve 17.387 testes, 17.098 aprovados, as MESMAS 128 falhas e os MESMOS seis arquivos sem coleta: nenhum teste novo falhou e nenhum teste existente mudou de aprovado para reprovado. Os 24 testes adicionais dessa rodada passaram. A rodada final teve 17.399 testes: 17.110 passaram, as mesmas 128 falhas e 161 pendentes, com os mesmos seis arquivos sem coleta. Os 36 testes adicionais passaram. Casos posteriores de prova e processamento foram retestados isoladamente: 62/62 aprovados. O comparador considerou tanto identidade do teste quanto falha de coleta, sem diferença nova.

A suíte geral continua vermelha por dívida reproduzida na base. O ratchet antigo compara contra arquivo estático desatualizado; por isso rotula falhas herdadas como introduzidas. O PR usa comparação explícita de identidades de teste main/branch, sem ampliar tolerâncias.

## Falhas fora do baseline reproduzidas na main

| Arquivo | Caso | Primeira mensagem |
| --- | --- | --- |
| tests/unit/InstanceRoutingSelector.test.tsx | campo de recuo aparece na política 'instância do responsável' | TestingLibraryElementError: Unable to find an accessible element with the role "combobox" and name `/se não houver conversa/i` |
| tests/unit/abrir-conversa-button.test.tsx | AbrirConversaButton lead sem telefone → botão não renderiza, em vez de renderizar inerte | Error: useAuth must be used within an AuthProvider |
| tests/unit/abrir-conversa-button.test.tsx | AbrirConversaButton uma caixa só → abre direto, sem mostrar seletor | Error: useAuth must be used within an AuthProvider |
| tests/unit/abrir-conversa-button.test.tsx | AbrirConversaButton duas caixas → pergunta, e não navega sozinho | Error: useAuth must be used within an AuthProvider |
| tests/unit/abrir-conversa-button.test.tsx | AbrirConversaButton escolher no seletor navega para a caixa escolhida | Error: useAuth must be used within an AuthProvider |
| tests/unit/abrir-conversa-button.test.tsx | AbrirConversaButton draft do copilot viaja como rascunho na URL, não como envio | Error: useAuth must be used within an AuthProvider |
| tests/unit/abrir-conversa-button.test.tsx | AbrirConversaButton nenhuma caixa na org → diz isso, em vez de abrir lista vazia | Error: useAuth must be used within an AuthProvider |
| tests/unit/agent-message-credentials.test.ts | agent-message AI credentials are scoped to eligible turns processes an eligible turn with the configured client | AssertionError: expected "vi.fn()" to be called with arguments: [ 'lead-test', 'QA', undefined ] |
| tests/unit/ai-action-executor-time-aware.test.ts | schedule_meeting — F5b time-aware blocking permite slot segunda 14h quando agente tem janela Comercial seg-sex | TypeError: Cannot read properties of null (reading 'id') |
| tests/unit/ai-action-executor-time-aware.test.ts | schedule_meeting — F5b time-aware blocking passa-through quando agente sem behavior_windows (legacy) | TypeError: Cannot read properties of null (reading 'id') |
| tests/unit/ai-action-executor-time-aware.test.ts | schedule_meeting — F5b time-aware blocking passa-through quando todas janelas com behavior vazio (backfill default) | TypeError: Cannot read properties of null (reading 'id') |
| tests/unit/automacao-tarefa-do-negocio.test.ts | schedule_meeting — a reunião é do Negócio carimba o negócio na tarefa da reunião | AssertionError: expected false to be true // Object.is equality |
| tests/unit/automacao-tarefa-do-negocio.test.ts | schedule_meeting — a reunião é do Negócio sem negócio declarado, a reunião fica da pessoa | TypeError: Cannot read properties of undefined (reading 'pipeline_entry_id') |
| tests/unit/command-metrics-org-switch.test.tsx | command metrics through the real organization switcher and identity cache keeps B's indicators when A's delayed reply arrives (virtual master: true) | AssertionError: expected null to be 'America/Sao_Paulo' // Object.is equality |
| tests/unit/copilot-observability.test.ts | copilot observability (#206) agent-message absorb loop tags emits copilot.absorb_iterations and copilot.lock_source after absorb loop | TypeError: supabase.from(...).select(...).in(...).order(...).order is not a function |
| tests/unit/copilot-tool-registry.test.ts | PLAYGROUND_TOOLS registry preserves all expected tool IDs | AssertionError: expected [ …(11) ] to have a length of 10 but got 11 |
| tests/unit/guided-workflow-worker.test.ts | uses the claimed publication or fails when unavailable: true | AssertionError: expected 503 to be 200 // Object.is equality |
| tests/unit/guided-workflow-worker.test.ts | uses the claimed publication or fails when unavailable: false | AssertionError: expected 503 to be 200 // Object.is equality |
| tests/unit/lead-card-novo-negocio.test.tsx | Card do Lead — o botão 'Criar negócio' abre a porta única o clique no card abre o diálogo de novo negócio | Error: [vitest] No "leadPhoneCompartilhadoKey" export is defined on the "@/modules/leads/hooks/useLeadPhones" mock. Did you forget to return it from "vi.mock"? |
| tests/unit/lead-card-novo-negocio.test.tsx | Card do Lead — o botão 'Criar negócio' abre a porta única oferece os funis vazios do lead — a mesma lista que a seção Negócios monta | Error: [vitest] No "leadPhoneCompartilhadoKey" export is defined on the "@/modules/leads/hooks/useLeadPhones" mock. Did you forget to return it from "vi.mock"? |
| tests/unit/lead-card-novo-negocio.test.tsx | Card do Lead — o botão 'Criar negócio' abre a porta única submeter chega na RPC de abrir negócio com funil, etapa e dono | Error: [vitest] No "leadPhoneCompartilhadoKey" export is defined on the "@/modules/leads/hooks/useLeadPhones" mock. Did you forget to return it from "vi.mock"? |
| tests/unit/lead-card-novo-negocio.test.tsx | Card do Lead — o botão 'Criar negócio' abre a porta única escolher outro funil troca o alvo da escrita, não só o destaque | Error: [vitest] No "leadPhoneCompartilhadoKey" export is defined on the "@/modules/leads/hooks/useLeadPhones" mock. Did you forget to return it from "vi.mock"? |
| tests/unit/lead-card-novo-negocio.test.tsx | Card do Lead — o botão 'Criar negócio' abre a porta única funil custom não vai pela RPC do sistema — escreve em custom_pipe_entries | Error: [vitest] No "leadPhoneCompartilhadoKey" export is defined on the "@/modules/leads/hooks/useLeadPhones" mock. Did you forget to return it from "vi.mock"? |
| tests/unit/lead-card-novo-negocio.test.tsx | Card do Lead — o botão 'Criar negócio' abre a porta única funil custom com dono escolhido CHECA a organização do dono antes de escrever | Error: [vitest] No "leadPhoneCompartilhadoKey" export is defined on the "@/modules/leads/hooks/useLeadPhones" mock. Did you forget to return it from "vi.mock"? |
| tests/unit/lead-card-novo-negocio.test.tsx | Card do Lead — o botão 'Criar negócio' abre a porta única dono de outra organização NÃO vira card no funil custom | Error: [vitest] No "leadPhoneCompartilhadoKey" export is defined on the "@/modules/leads/hooks/useLeadPhones" mock. Did you forget to return it from "vi.mock"? |
| tests/unit/lead-card-novo-negocio.test.tsx | Card do Lead — o botão 'Criar negócio' abre a porta única a observação digitada vai junto — é o contexto de quem pegar o negócio | Error: [vitest] No "leadPhoneCompartilhadoKey" export is defined on the "@/modules/leads/hooks/useLeadPhones" mock. Did you forget to return it from "vi.mock"? |
| tests/unit/lead-card-novo-negocio.test.tsx | Card do Lead — o botão 'Criar negócio' abre a porta única o diálogo fecha depois de criar | Error: [vitest] No "leadPhoneCompartilhadoKey" export is defined on the "@/modules/leads/hooks/useLeadPhones" mock. Did you forget to return it from "vi.mock"? |
| tests/unit/lead-card-novo-negocio.test.tsx | Card do Lead — o botão 'Criar negócio' abre a porta única erro na escrita mantém o diálogo aberto — o rascunho não se perde | Error: [vitest] No "leadPhoneCompartilhadoKey" export is defined on the "@/modules/leads/hooks/useLeadPhones" mock. Did you forget to return it from "vi.mock"? |
| tests/unit/lead-card-novo-negocio.test.tsx | Card do Lead — o que o diálogo recusa sem permissão o diálogo abre, mas não há o que criar | Error: [vitest] No "leadPhoneCompartilhadoKey" export is defined on the "@/modules/leads/hooks/useLeadPhones" mock. Did you forget to return it from "vi.mock"? |
| tests/unit/lead-card-novo-negocio.test.tsx | Card do Lead — o que o diálogo recusa lead com negócio em todos os funis vê a explicação, não um diálogo vazio | Error: [vitest] No "leadPhoneCompartilhadoKey" export is defined on the "@/modules/leads/hooks/useLeadPhones" mock. Did you forget to return it from "vi.mock"? |
| tests/unit/lead-card-novo-negocio.test.tsx | Card do Lead — o que o diálogo recusa Carteira destravada pela venda fechada passa a ser opção escolhível | Error: [vitest] No "leadPhoneCompartilhadoKey" export is defined on the "@/modules/leads/hooks/useLeadPhones" mock. Did you forget to return it from "vi.mock"? |
| tests/unit/lead-card-novo-negocio.test.tsx | Registrar venda pelo Card do Lead abre pelo card sem negócios e só grava a lista ao salvar | Error: [vitest] No "leadPhoneCompartilhadoKey" export is defined on the "@/modules/leads/hooks/useLeadPhones" mock. Did you forget to return it from "vi.mock"? |
| tests/unit/lead-card.test.tsx | LeadCardContainer — para onde cada campo escreve recusa gravar campo sem coluna, mesmo chamado direto | Error: No QueryClient set, use QueryClientProvider to set one |
| tests/unit/lead-card.test.tsx | LeadCardContainer — para onde cada campo escreve campo da organização vai por saveCustomField, com a chave como id da definição | Error: No QueryClient set, use QueryClientProvider to set one |
| tests/unit/lead-card.test.tsx | LeadCardContainer — para onde cada campo escreve campo do sistema vai por updateLead, com a chave como nome da coluna | Error: No QueryClient set, use QueryClientProvider to set one |
| tests/unit/lead-card.test.tsx | LeadCardContainer — para onde cada campo escreve apagar o texto de um campo do sistema grava NULL, não string vazia | Error: No QueryClient set, use QueryClientProvider to set one |
| tests/unit/lead-card.test.tsx | LeadCardContainer — para onde cada campo escreve chave desconhecida não vira escrita | Error: No QueryClient set, use QueryClientProvider to set one |
| tests/unit/lead-card.test.tsx | LeadCardContainer — lead invisível tem três causas diferentes lixeira | Error: No QueryClient set, use QueryClientProvider to set one |
| tests/unit/lead-card.test.tsx | LeadCardContainer — lead invisível tem três causas diferentes sem permissão | Error: No QueryClient set, use QueryClientProvider to set one |
| tests/unit/lead-card.test.tsx | LeadCardContainer — lead invisível tem três causas diferentes inexistente | Error: No QueryClient set, use QueryClientProvider to set one |
| tests/unit/lead-card.test.tsx | LeadCardContainer — lead invisível tem três causas diferentes fechado não renderiza nada | Error: No QueryClient set, use QueryClientProvider to set one |
| tests/unit/role-vocabulary.test.ts | vocabulário de team_members.role nenhum literal de role fora do enum em src/, tests/ e supabase/functions/ | AssertionError: Literal de role fora do enum app_role (admin, agency, bdr, cliente, closer, member, sdr). |
| tests/unit/shared-logger-actor.test.ts | logRuntime — atribuição de ator (ADR-0021 §7) log de gestor grava actor_type='gestor' + gestor_id + triggered_by real | AssertionError: expected [ { organization_id: 'org-A', …(17) } ] to match object { actor_type: 'gestor', …(3) } |
| tests/unit/shared-logger-actor.test.ts | logRuntime — atribuição de ator (ADR-0021 §7) log normal NÃO referencia colunas de atribuição de gestor (zero regressão pré-apply) | TypeError: Cannot convert undefined or null to object |
| tests/unit/shared-logger-actor.test.ts | logRuntime — atribuição de ator (ADR-0021 §7) actorType sem gestorId grava actor_type mas omite gestor_id | AssertionError: expected [ { …(16) }, { …(17) } ] to match object { actor_type: 'master' } |
| tests/unit/use-whatsapp-chat.test.ts | useSendWhatsAppMessage sends a text message via Evolution API | AssertionError: expected "vi.fn()" to be called at least once |
| tests/unit/use-whatsapp-chat.test.ts | useSendWhatsAppMessage sends via SZ.chat when instance is SZ.chat backed | AssertionError: expected "vi.fn()" to be called at least once |
| src/modules/leads/pages/Leads.busca-debounce.test.tsx | Leads.tsx — busca com debounce o input acompanha cada tecla; as queries só veem o termo final, 300 ms depois | Error: No QueryClient set, use QueryClientProvider to set one |
| src/modules/leads/pages/Leads.carteira-redirect.test.tsx | Leads.tsx com a aba antiga `cliente` redireciona sem pintar a página e repassa ?lead= SEM abrir o lead em Leads | Error: No QueryClient set, use QueryClientProvider to set one |
| src/modules/leads/pages/Leads.carteira-redirect.test.tsx | Leads.tsx com a aba antiga `cliente` controle: aba `lead` pinta a lista, busca e abre o ?lead= em Leads | Error: No QueryClient set, use QueryClientProvider to set one |

## Arquivos sem coleta, iguais na main e branch

- `tests/unit/evolution-api.test.ts` — Failed to resolve import "@/lib/evolutionApi" from "tests/unit/evolution-api.test.ts". Does the file exist?
- `tests/unit/hooks-batch-8-channel-chat.test.ts` — Failed to resolve import "@/hooks/useChannelChat" from "tests/unit/hooks-batch-8-channel-chat.test.ts". Does the file exist?
- `tests/unit/hooks-deep-1.test.ts` — Failed to resolve import "@/hooks/useChannelChat" from "tests/unit/hooks-deep-1.test.ts". Does the file exist?
- `tests/unit/hooks-final-instances.test.ts` — Failed to resolve import "@/lib/evolutionApi" from "tests/unit/hooks-final-instances.test.ts". Does the file exist?
- `tests/unit/pix-charge-flow.test.tsx` — Failed to resolve import "@/hooks/useCreateAsaasPixCharge" from "tests/unit/pix-charge-flow.test.tsx". Does the file exist?
- `tests/unit/pricing-calculator.test.ts` — Failed to resolve import "../../src/lib/pricing-calculator" from "tests/unit/pricing-calculator.test.ts". Does the file exist?

## Tratamento neste PR

Correções novas de contratos de hook acrescentam organization_id/conversationId aos testes afetados; projeções deixam de incluir tokens. Um mock de paginação usava domínio fictício fora do Graph e foi ajustado para respeitar a proteção de origem. O helper compartilhado de Supabase não simulava falha de upsert; agora respeita mockInsertError e tem regressão própria, evitando teste de durabilidade falsamente verde. Consumidores desse mecanismo foram retestados.

Não foram alterados módulos de Leads, Copilot, VoIP ou WhatsApp para esconder dívida da suíte. Correções dessas falhas exigem trabalho próprio sobre fixtures/providers, imports legados, contratos de UI/registries e expectativas temporais.

## Gates finais

- Build passou; avisos de chunks grandes já existem na base.
- Typecheck e ESLint ratchets passaram com zero problemas introduzidos.
- Onze endpoints alterados/preparados passaram Deno check.
- PostgreSQL PGlite: duas suítes passaram, incluindo grants herdados por coluna, EXECUTE, remoção/demissão de admin, nonce, transações, troca explícita de app, deduplicação e exclusão.
- Focados: 130/130 em 17 arquivos; autorização dos dois endpoints novos 6/6; regressão do consumidor de mockInsertError 12/12. Esses recortes sobrepõem parcialmente a suíte ampla; não somar como testes únicos.
- Nenhum baseline ou dependência foi alterado. Validação remota e piloto Meta continuam gates de ativação.

## Fluxo completo no produto

Após a comparação ampla, painel Meta ganhou leitura das contas/métricas por organização, datas e paginação. Retorno OAuth abre a aba/modal corretos. Recorte final de todos os testes Meta e catálogo: **266/266 aprovados em 34 arquivos**, incluindo mudança de organização sem reaproveitar métricas do tenant anterior, membro sem acesso, período inválido e re-request de permissões. Build e typecheck foram repetidos para a interface; sem erros novos. Preview local desktop/mobile foi conferido com dados sintéticos, sem conexão a ativos reais; não serve como prova de App Review.

## Varredura de segurança

A varredura do histórico deste PR não encontrou ocorrências. O ensaio das regras passou com três exemplos positivos artificiais, exemplos públicos e conteúdo versionado. A ocorrência remota anterior veio de prosa comum no cabeçalho do runbook. A revisão permitiu somente sua localização histórica exata em .gitleaksignore; a redação atual foi alterada. As regras do detector não foram enfraquecidas.

## Correção dos bloqueios autorizada em 25/10/2026

O proprietário ampliou o escopo para corrigir a dívida que bloqueava CI. Nenhum baseline foi ampliado e nenhuma suíte foi movida para pendente para obter aprovação.

- Unit: 50 contratos/mocks corrigidos; gate completo aprovado no GitHub no head be741d6ca.
- RLS: gate aprovado, 112 arquivos e 2.444 asserções. As duas suítes de funcionalidades pendentes previamente existentes continuam classificadas como antes, sem alteração neste PR.
- Integração: 584 testes aprovados; o único controle restante revelou defeito real em `voip_can_see_call`: permissão global de leitura de leads podia produzir `true` para lead de outra organização. Definição em produção inspecionada e mesmo defeito confirmado no predicado. Migration `20271215020000` exige vínculo com tenant antes dos dois caminhos de autorização, preserva master e caso órfão, fixa search_path vazio e nega anon. Aplicada em produção em 26/10/2026 após revisão, ensaio PGlite e aprovação do controle cross-tenant na integração do CI; grants e tenant gate verificados no alvo.
- E2E: última rodada encerrou com 89 aprovados e 26 falhas. Rotas canônicas usam slug (`/funil/whatsapp`), não UUID; expectativas e campos de formulário foram corrigidos. Restam revisão de respostas legítimas de skip do Copilot, recursos opcionais ausentes no seed, overlay de introdução, call site de follow-up e contagem de negócios afetada pelos novos fixtures.
- Carteira: seis cenários completos passaram localmente no projeto de preview separado, incluindo mobile, teclado, filtros e histórico.

Não confundir gate verde, fixture simulada ou worker vazio com piloto Meta real. OAuth continua desligado até frontend compatível publicado e gates conclusivos.

Network traces identified the remaining console errors precisely: `master_users` returned 406 for an expected absent optional row, now queried with `maybeSingle`; `realtime_subscription_plan` returned 404/42883 because optional `private.strict_lead_member_orgs()` is absent in a clean replay. Migration `20271215030000` disables broadcast when this guard is missing, preserving Postgres Changes fallback and never bypassing owner isolation. PGlite verifies missing guard, normal membership, strict owner, invalid topic and cross-tenant denial. Production has this optional guard installed. Migration applied on 26 October after CI integration/RLS and PGlite validation; authenticated access and empty search_path verified on target.

The intro overlay was still present and opaque in a failed trace after the click deadline. Dismissal scheduling now follows the visibility captured for the mounted component, rather than rereading the mutable module-level played flag. CI browser verification remains required.

## Atualização de 26/10 — publicação e rodada final

App Meta confirmado como Publicado pelo painel autenticado. Permissões continuam Pronto para teste, com contador zero, e webhook de Página ainda não configurado: publicação não comprova aprovação avançada nem piloto.

Head `77d24d8ef` passou integração, RLS, lint/build, Cloudflare, CodeQL e secret scan. Unitários/E2E ainda em execução no registro desta atualização. Os 11 testes focados de useMasterAuth passaram após alinhamento do mock com maybeSingle; contratos Copilot explicitam o skip no_active_agents, sem inventar ação ou lead; telefones de API são únicos. Follow-up expande item antes de Ver Lead; ações de criação seguem cada pipeline; oráculo de métricas inclui os três negócios sem lead correspondentes aos fixtures. Intro possui deadline final de remoção do overlay. Baselines não ampliados.

Main `d23ae39c8` incorporada sem conflitos para preservar correção independente de adoção de leads ERP. Gates finais devem usar o novo head, não apenas a execução anterior. OAuth permanece desligado até frontend compatível publicado.

## Rodada d2dd3af82 — 26/10

Unit ratchet, Integration, RLS, Deno, Workflow System, lint/build, Cloudflare, CodeQL e Secret Scan aprovados. E2E: 117 aprovados, três intermitentes e uma falha, mantendo oito skips preexistentes. Trace confirmou compositor exibindo `1 de 3`: profundidade conta operadores, com folhas em zero. A interface impedia converter folha no nível 3, limitando composição a duas operações; guard corrigido para permitir a terceira e negar a quarta. E2E expande todas as ramificações e verifica limite e sete operadores.

Tentativas de Métricas reaproveitavam aba persistida, duplicando janelas e violando locators estritos. Cada teste/tentativa agora cria aba exclusiva, inclusive na verificação de persistência após reload. Dois casos intermitentes de lead/reunião foram interceptados pelo modal de sugestões de primeiro uso; fixture de browser registra a dispensa prévia dos usuários desses cenários. Testes dedicados do prompt e seed de integração permanecem preservados. ESLint focado e coleta Playwright passaram; confirmação funcional depende da próxima rodada CI.
