# Rascunhos de pedidos Toth — fundação local

Data: 2026-09-17. Escopo autorizado: construir o lado do CRM preservando os dados e fluxos atuais. Base de decisões: [roadmap](../../docs/plans/cafe-jurere-escrita-erp-roadmap.md).

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

## Limite mecânico de escrita

Não existe adaptador de escrita nem chamada HTTP ao ERP nesta fundação. O frontend não possui mutation de envio. A RPC `toth_request_order_send` verifica acesso e sempre recusa com `toth_write_contract_unverified`, inclusive para administrador com revisão válida. Alterar a flag ou manipular o botão não habilita escrita.

Não há fila de envios ou worker nesta entrega: persistir um comando que ninguém pode executar passaria uma falsa impressão de envio pendente. Registro de operação de saída, confirmação remota, idempotência do fornecedor e conciliação de efeitos comerciais serão implementados quando o contrato permitir testá-los.

## Persistência e autorização

RPCs da fundação:

- `toth_order_workspace(p_deal_id)` — situação, permissões, rascunho, catálogo e histórico.
- `toth_save_order_draft(p_deal_id, p_expected_revision, p_items, p_notes)` — criação ou mudança com controle de versão e invalidação da revisão.
- `toth_review_order_draft(p_deal_id, p_expected_revision)` — conferência local da versão salva.
- `toth_order_preparer_access(p_deal_id)` e `toth_set_order_preparer(p_deal_id, p_team_member_id, p_enabled)` — concessões explícitas, controladas por administrador.
- `toth_request_order_send(p_deal_id, p_expected_revision)` — bloqueio permanente desta entrega.

Organização derivada do negócio e verificada no servidor contra usuário autenticado, vínculo ativo e acesso ao lead. Nenhuma RPC aceita `organization_id` do navegador. `master` não é role e não ganha permissão implícita para este piloto. Tabelas novas com RLS, sem permissão de escrita direta para `authenticated`/`anon`; mudanças passam por RPCs com `search_path` fixo e grants explícitos.

Os tipos gerados do Supabase não são editados. Uma ponte tipada e restrita às RPCs de rascunho mantém a compatibilidade até aplicar a migration e regenerar os tipos no ambiente correto.

## Implantação futura

1. Validar a migration isoladamente e revisar grants, RLS e acessos positivos/negativos no alvo de homologação; o harness local não substitui essa validação.
2. Aplicar somente a migration nova, após autorização do ambiente. Não executar `db push` indiscriminadamente sobre a cadeia do repositório.
3. Publicar frontend com flag desligada; função ausente gera mensagem de indisponibilidade, não tentativa de escrita por outro caminho.
4. Habilitar a flag exclusivamente na organização piloto após autorização. A migration não altera flags, cadastros, pedidos, credenciais ou cron existente.
5. Alimentar catálogo apenas por um adaptador validado ou fixtures em ambiente isolado. Não transformar itens históricos, preços digitados ou uma lista manual de produção em catálogo autorizado do Toth.
6. Para interromper uso, desligar a flag; preservar rascunhos e auditoria. Nenhuma reversão ou exclusão de dados existentes é necessária.

## Pendências para as próximas entregas

Contrato de catálogo comercial e escrita; homologação isolada do ERP; vínculo inequívoco de empresa/filial/representante; validação de preço/crédito/estoque; identificação estável de operação e consulta de resultado; concorrência remota; confirmação, recuperação e conciliação sem dupla venda; alteração/cancelamento com motivo e estados operacionais. Essas dependências não são consideradas resolvidas pela revisão local do rascunho.

Os três estados futuros — situação do pedido, execução da operação e conciliação no CRM — serão definidos com o contrato. A fundação mantém apenas versão e conferência do rascunho, evitando gravar estados operacionais fictícios.

## Revisão de segurança e validação local

Aplicada a `.claude/skills/security-rubric/SKILL.md` ao diff. Revisão independente identificou e corrigiu contagem de vínculos ambíguos, proteção de snapshots quando o lead do negócio muda, autorização anterior ao lock e revisão após exclusão do usuário revisor. Testes exercitam papéis PostgreSQL reais no harness, inclusive os grants explícitos padrão do projeto.

`npm run test:toth-drafts`: **24 testes passaram** em PostgreSQL em memória (PGlite), com fixtures fictícios, nenhuma rede ou banco remoto. Cobre RLS, grants, organização, acesso ao lead, concessões, flag desligada, versão desatualizada, catálogo, auditoria, barreira de envio, masters com/sem vínculo e igualdade dos dados comerciais antes/depois. O harness usa substitutos das funções de identidade do projeto; homologação do schema completo e corrida entre sessões independentes continuam necessárias antes do apply real.

`tests/unit/preview-cards-sem-banco.test.ts`, `deal-card.test.tsx`, `deal-card-produtos.test.tsx` e `toth-order-slot.test.tsx`: **67 testes passaram**. A prévia continua sem caminho até banco e a montagem do painel permanece restrita ao piloto. Não houve QA visual autenticado contra produção.

Domínio: **40 testes passaram**. Painel e hook: **15 testes passaram**, incluindo troca de conta da mesma organização durante uma mutation em andamento. Cache e formulário são isolados por organização, membro e negócio; a resposta pendente atualiza apenas o cache da conta que iniciou a operação. Lint ratchet passou sem problemas introduzidos.

Build local passou. Verificador de dependências encontrou um ciclo **herdado**, confirmado nos arquivos de `c99515b50` sem diff: `DisparoWizard.tsx:37` → `carteira/index.ts:170` → `useAutoMoveUpsellClients.ts:4` → `pipelines/index.ts:280` → `disparo/index.ts:3`. O checker inclui imports de tipo (`tsPreCompilationDeps`), e o ciclo não depende do novo painel. O baseline de dependências não foi alterado.

A suíte geral `npm run test:ratchet` não ficou verde: reportou 24 falhas persistentes fora dos arquivos Toth após a repetição automática. Para atribuição, seis arquivos foram executados isoladamente no código atual e em um checkout de `c99515b50`: ambos executaram 61 testes e apresentaram as mesmas 22 falhas, sem diferença entre os nomes. Onze são limitações do ambiente Windows (`grep` ausente e Bash/WSL sem `/bin/bash`); onze já existem em Agenda, automações e FunilKanban. Isso comprova ausência de regressão nesses seis arquivos, mas não atribui individualmente todas as falhas da suíte geral. O PR permanece em rascunho; nenhum baseline de testes foi alterado. Checkout temporário, junction e archive usados na comparação foram removidos.

O guard `master-ghost` permite exceções revisadas para funções deliberadamente restritas a membros. Foram revisadas quatro exceções deste piloto: `toth_order_can_read`, `toth_order_workspace`, `toth_order_preparer_access` e `toth_set_order_preparer`. A decisão do CTO limita a atuação aos administradores da organização e preparadores autorizados; ser master sem vínculo ativo não concede acesso aqui. Um master que também seja membro/admin ativo segue exatamente as permissões locais. Acrescentar um bypass de master ampliaria o escopo aprovado. O ajuste do baseline é limitado aos quatro nomes, sem absorver as demais divergências herdadas nem reescrever o baseline inteiro.

Após essas quatro exceções revisadas, o guard ainda reporta 24 entradas novas e 42 obsoletas preexistentes fora de Toth. Essa dívida permanece explícita para revisão, sem ajuste abrangente do baseline.

Migration nova: `20271021000013_toth_order_drafts.sql`, gerada inicialmente pela CLI e renomeada antes de qualquer aplicação para ficar após as dependências com datas futuras existentes. Não aplicada em ambiente remoto. Nenhuma branch de Supabase foi criada; não há recurso temporário remoto para limpar.
