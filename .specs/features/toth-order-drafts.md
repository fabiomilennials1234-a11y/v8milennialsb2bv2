# Pré-pedidos Toth — preparação e processamento local

Fundação: 2026-09-17. Ampliação autorizada pelo usuário em 2026-09-21: implementar o lado do CRM para pré-pedidos e ganho somente após aprovação confirmada no ERP. Base de decisões: [roadmap](../../docs/plans/cafe-jurere-escrita-erp-roadmap.md). O contrato HTTP da Toth e a homologação continuam pendentes; esta entrega não ativa escrita real. Operação e critérios de liberação: [runbook](../../docs/operations/toth-preorder-processing.md).

## Comportamento

Na ficha do negócio, em Produtos e Valores, a Café Jurerê poderá preparar um rascunho separado dos itens e valores comerciais existentes. O painel aparece apenas com a flag booleana `organizations.feature_flags.toth_order_drafts = true` e o ID da organização piloto. A flag não é habilitada pela migration.

- Um rascunho por negócio, sem criar pedidos em `upsell_orders`, mudar desfecho, alterar itens do negócio ou emitir eventos de venda.
- Administradores da organização preparam e conferem. Outros membros precisam de concessão explícita para preparar e de acesso ao lead do negócio. A administração das concessões fica no painel; ela não amplia o acesso aos leads.
- Produtos escolhidos exclusivamente de um catálogo local dedicado, alimentável apenas pelo serviço autorizado. Sem catálogo, o painel informa a pendência; é possível salvar observações, mas não inventar produtos ou conferir um pedido vazio.
- Catálogo e revisão são preparação local, não validação comercial. Não há campos de preço livre, desconto, crédito ou condição comercial inventada. Valores, condições, estoque, frete e empresa/representante continuam dependentes do contrato Toth.
- Alteração exige a revisão esperada; versão desatualizada é recusada. Toda mudança invalida a conferência anterior.
- Conferência de administrador registra autor, instante e versão exata. Não marca o negócio como ganho e não autoriza envio.
- Alterações locais não são descartadas automaticamente após conflito ou atualização de dados em segundo plano. Recarregar a versão atual exige ação do usuário.
- Histórico registra operações locais. Não há transmissão real, sucesso simulado ou mudança em pedido histórico.

## Processamento implementado em 21/09/2026

Uma operação persistente por negócio congela a revisão conferida, cliente, itens e situação original. A admissão requer administrador ativo, acesso ao negócio, revisão atual, catálogo válido e capacidade de execução verificada. A operação registra separadamente entrega (`queued`, `sending`, `awaiting_confirmation`, `received`, `failed`, `blocked`), decisão comercial (`unknown`, `pending`, `approved`, `rejected`) e conciliação (`not_due`, `pending`, `complete`, `blocked`).

O processador interno `toth-process-preorder` recebe somente o ID da operação, exige `x-cron-secret` e usa RPCs exclusivas de serviço. Reserva temporária com token, transição persistida antes da chamada e validação do retorno impedem dois processadores de enviarem o mesmo comando. Recuperar uma operação em envio ou com resultado incerto permite apenas consultar; não cria novamente, mesmo se a consulta ainda não encontrar resultado. A resposta de criação nunca concede aprovação comercial.

Uma consulta autoritativa deve confirmar identidade, estado conhecido, total aprovado e ordem confiável da observação. Observações antigas são ignoradas; conflitos bloqueiam. Essa ordenação é um requisito ainda não demonstrado pela Toth, não uma versão remota presumida nem o horário local da consulta.

Aprovação registrada concilia o ganho pelo caminho canônico de `deals.outcome` e seus triggers existentes. Venda e espelho na Carteira não são inseridos por um segundo caminho. Falha local preserva a aprovação e permite recuperar somente a conciliação. Um negócio já ganho não gera outra venda; identidade ou total divergentes bloqueiam. Transições novas para ganho de negócios com operação exigem aprovação e total compatível, incluindo chamadas manuais e automações. Após aprovação, ajuste manual de valor/composição, reversão ou reabertura são recusados para os registros vinculados; a proteção alcança os caminhos canônicos de etapa e ajuste sem ampliar a restrição aos históricos sem operação.

A importação existente consulta a propriedade do ID antes de gravar. Um trigger com lock por organização/ID fecha a corrida entre vinculação e importação. Pedidos históricos sem operação mantêm seu comportamento; se um pedido importado já existir antes do vínculo, ele é preservado e a operação bloqueada para conferência. O importador legado nunca fornece aprovação à nova integração.

O painel distingue recebimento, análise, rejeição, aprovação e atualização local pendente. A atualização manual consulta apenas o estado local; não chama o ERP nem descarta edição não salva do rascunho. Dados antigos são ocultados quando uma consulta perde autorização ou falha.

## Limite mecânico de escrita

O frontend não possui mutation de envio. A função privada `preorder_runtime_ready()` retorna sempre `false` nesta entrega, portanto `toth_request_order_send` continua recusando com `toth_write_contract_unverified`. Nenhuma operação é criada pelo usuário enquanto esse limite permanecer fechado. O adaptador padrão declara criação e consulta indisponíveis e não contém URLs ou chamadas HTTP ao ERP. Alterar a flag ou `TOTH_PREORDER_SEND_ENABLED` não configura esse adaptador nem abre a admissão SQL.

Há processador e persistência implementados e testados localmente, mas nenhum agendamento ou webhook instalado. Completar o adaptador real, o snapshot comercial e a homologação é necessário antes de habilitar envio. Não há sucesso simulado em produção.

## Persistência e autorização

RPCs da fundação:

- `toth_order_workspace(p_deal_id)` — situação, permissões, rascunho, catálogo e histórico.
- `toth_save_order_draft(p_deal_id, p_expected_revision, p_items, p_notes)` — criação ou mudança com controle de versão e invalidação da revisão.
- `toth_review_order_draft(p_deal_id, p_expected_revision)` — conferência local da versão salva.
- `toth_order_preparer_access(p_deal_id)` e `toth_set_order_preparer(p_deal_id, p_team_member_id, p_enabled)` — concessões explícitas, controladas por administrador.
- `toth_request_order_send(p_deal_id, p_expected_revision)` — admissão persistente com barreira fechada nesta entrega.
- `toth_preorder_workspace(p_deal_id)` — estado público da operação e impedimentos; não expõe snapshot, credencial ou reserva do processador.

As RPCs de reserva, transição para envio, registro de observação, conciliação, liberação e consulta de propriedade são exclusivas de `service_role`. As novas tabelas de operações/auditoria têm RLS e nenhuma permissão de acesso direto para navegador ou serviço; o processador passa pelas RPCs restritas. A origem e o snapshot da operação são imutáveis. O navegador nunca transmite estado de aprovação.

Organização derivada do negócio e verificada no servidor contra usuário autenticado, vínculo ativo e acesso ao lead. Nenhuma RPC aceita `organization_id` do navegador. `master` não é role e não ganha permissão implícita para este piloto. Tabelas novas com RLS, sem permissão de escrita direta para `authenticated`/`anon`; mudanças passam por RPCs com `search_path` fixo e grants explícitos.

Os tipos gerados do Supabase não são editados. Uma ponte tipada e restrita às RPCs de rascunho mantém a compatibilidade até aplicar a migration e regenerar os tipos no ambiente correto.

## Implantação futura

1. Validar a migration isoladamente e revisar grants, RLS e acessos positivos/negativos no alvo de homologação; o harness local não substitui essa validação.
2. Aplicar as migrations novas `20271021000016_toth_order_drafts.sql` e `20271021000021_toth_preorder_operations.sql` na ordem das dependências, após autorização do ambiente. Não executar `db push` indiscriminadamente sobre a cadeia do repositório.
3. Publicar frontend com flag desligada; função ausente gera mensagem de indisponibilidade, não tentativa de escrita por outro caminho.
4. Habilitar a flag exclusivamente na organização piloto após autorização. A migration não altera flags, cadastros, pedidos, credenciais ou cron existente.
5. Alimentar catálogo apenas por um adaptador validado ou fixtures em ambiente isolado. Não transformar itens históricos, preços digitados ou uma lista manual de produção em catálogo autorizado do Toth.
6. Para interromper uso, desligar a flag; preservar rascunhos e auditoria. Nenhuma reversão ou exclusão de dados existentes é necessária.

## Pendências para as próximas entregas

Atualização de 21/09/2026: a [resposta encaminhada da Toth](../../docs/plans/cafe-jurere-etapa-0/resposta-fornecedor-2026-09-21.md) informa que a API recebe pré-pedidos sujeitos à análise na empresa. O usuário confirmou ganho somente após aprovação no ERP e solicitou a implementação. Alteração/cancelamento não foram oferecidos por API, controle remoto de versão foi declarado ausente e homologação precisa ser criada. A implementação avança em criação/acompanhamento sem liberar comandos ausentes no contrato.

Contrato de catálogo comercial e escrita; homologação isolada do ERP; vínculo inequívoco de empresa/filial/representante; validação de preço/crédito/estoque; identificação estável de operação e consulta de resultado; concorrência remota; confirmação, recuperação e conciliação sem dupla venda; alteração/cancelamento com motivo e estados operacionais. Essas dependências não são consideradas resolvidas pela revisão local do rascunho.

Os três eixos internos já estão implementados; o mapeamento dos estados reais da Toth permanece pendente. Rejeição não marca perda nem permite novo pedido no mesmo negócio automaticamente. Divergências de total/estado após aprovação bloqueiam para conferência, preservando a última venda reconhecida. Ajustes pela diferença, reversões, resolução administrativa dessas pendências e alertas automáticos continuam entregas futuras; as decisões 15–17 do roadmap não foram consideradas cumpridas por esse bloqueio.

## Validação da fundação de 17/09/2026

Os resultados abaixo se referem à fundação anterior. A validação da ampliação de 21/09 está registrada no [runbook](../../docs/operations/toth-preorder-processing.md).

Aplicada a `.claude/skills/security-rubric/SKILL.md` ao diff. Revisão independente identificou e corrigiu contagem de vínculos ambíguos, proteção de snapshots quando o lead do negócio muda, autorização anterior ao lock e revisão após exclusão do usuário revisor. Testes exercitam papéis PostgreSQL reais no harness, inclusive os grants explícitos padrão do projeto.

`npm run test:toth-drafts`: **24 testes passaram** em PostgreSQL em memória (PGlite), com fixtures fictícios, nenhuma rede ou banco remoto. Cobre RLS, grants, organização, acesso ao lead, concessões, flag desligada, versão desatualizada, catálogo, auditoria, barreira de envio, masters com/sem vínculo e igualdade dos dados comerciais antes/depois. O harness usa substitutos das funções de identidade do projeto; homologação do schema completo e corrida entre sessões independentes continuam necessárias antes do apply real.

`tests/unit/preview-cards-sem-banco.test.ts`, `deal-card.test.tsx`, `deal-card-produtos.test.tsx` e `toth-order-slot.test.tsx`: **67 testes passaram**. A prévia continua sem caminho até banco e a montagem do painel permanece restrita ao piloto. Não houve QA visual autenticado contra produção.

Domínio: **40 testes passaram**. Painel e hook: **15 testes passaram**, incluindo troca de conta da mesma organização durante uma mutation em andamento. Cache e formulário são isolados por organização, membro e negócio; a resposta pendente atualiza apenas o cache da conta que iniciou a operação. Lint ratchet passou sem problemas introduzidos. A repetição final de `npm run typecheck:ratchet` também passou: zero erros introduzidos, com a dívida já registrada de 804 assinaturas de baseline e 10 herdadas (469 ocorrências atuais), sem alteração desses baselines.

Build local passou. Verificador de dependências encontrou um ciclo **herdado**, confirmado nos arquivos de `c99515b50` sem diff: `DisparoWizard.tsx:37` → `carteira/index.ts:170` → `useAutoMoveUpsellClients.ts:4` → `pipelines/index.ts:280` → `disparo/index.ts:3`. O checker inclui imports de tipo (`tsPreCompilationDeps`), e o ciclo não depende do novo painel. O baseline de dependências não foi alterado.

A suíte geral `npm run test:ratchet` não ficou verde: reportou 24 falhas persistentes fora dos arquivos Toth após a repetição automática. Para atribuição, seis arquivos foram executados isoladamente no código atual e em um checkout de `c99515b50`: ambos executaram 61 testes e apresentaram as mesmas 22 falhas, sem diferença entre os nomes. Onze são limitações do ambiente Windows (`grep` ausente e Bash/WSL sem `/bin/bash`); onze já existem em Agenda, automações e FunilKanban. Isso comprova ausência de regressão nesses seis arquivos, mas não atribui individualmente todas as falhas da suíte geral. O PR permanece em rascunho; nenhum baseline de testes foi alterado. Checkout temporário, junction e archive usados na comparação foram removidos.

O guard `master-ghost` permite exceções revisadas para funções deliberadamente restritas a membros. Foram revisadas quatro exceções deste piloto: `toth_order_can_read`, `toth_order_workspace`, `toth_order_preparer_access` e `toth_set_order_preparer`. A decisão do CTO limita a atuação aos administradores da organização e preparadores autorizados; ser master sem vínculo ativo não concede acesso aqui. Um master que também seja membro/admin ativo segue exatamente as permissões locais. Acrescentar um bypass de master ampliaria o escopo aprovado. O ajuste do baseline é limitado aos quatro nomes, sem absorver as demais divergências herdadas nem reescrever o baseline inteiro.

Após essas quatro exceções revisadas, o guard ainda reporta 24 entradas novas e 42 obsoletas preexistentes fora de Toth. Essa dívida permanece explícita para revisão, sem ajuste abrangente do baseline.

No [PR #2133](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/pull/2133), os seis jobs de GitHub Actions terminaram antes de executar qualquer etapa (`steps: []`). As annotations informam pagamento recente com falha ou necessidade de aumentar o limite de gastos da conta; não distinguem qual das duas condições ocorreu. Evidências: [Lint & Build](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/actions/runs/35264411678/job/105347857534), [CodeQL](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/actions/runs/35264411704/job/105347859089) e [gitleaks](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/actions/runs/35264411735/job/105347857956). Essa validação remota não ocorreu; não foram alterados cobrança, configuração de CI ou workflows para contornar o bloqueio.

Migration nova: `20271021000016_toth_order_drafts.sql`, gerada inicialmente pela CLI e renomeada antes de qualquer aplicação para ficar após as dependências com datas futuras existentes. A versão inicialmente proposta, `20271021000013`, colidiu com outra migration integrada à `main`; a versão foi ajustada antes do merge solicitado pelo usuário nesta conversa em 2026-09-17, sem alterar o conteúdo SQL. Não aplicada em ambiente remoto. Nenhuma branch de Supabase foi criada; não há recurso temporário remoto para limpar.
