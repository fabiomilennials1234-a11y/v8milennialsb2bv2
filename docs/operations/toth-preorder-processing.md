# Pré-pedidos Toth — implementação e liberação

Data: 2026-09-21. Escopo: Café Jurerê, organização piloto já definida na fundação. Implementação local autorizada; nenhuma migration aplicada, função publicada, flag ativada ou chamada ao ERP realizada nesta entrega. Não foi criada VM ou branch remota de Supabase.

## O que está implementado

- Rascunho versionado, conferência por administrador, concessão para preparadores e catálogo local isolado, entregues na fundação.
- Operação durável única por negócio, snapshot imutável da revisão e auditoria das transições.
- Reserva temporária exclusiva do processador, gravação de `sending` antes de I/O e revalidação de permissões, cliente, catálogo e negócio antes da primeira criação.
- Recuperação de resposta perdida exclusivamente por consulta. Não há repetição automática da criação.
- Separação entre entrega, decisão comercial e conciliação. Somente consulta autoritativa aprova comercialmente.
- Ganho e valor aprovado pelo caminho canônico já usado pelo CRM, preservando uma venda e um espelho na Carteira. Falha local preserva aprovação para recuperar a conciliação.
- Travas dedicadas a negócios com operação nova, impedindo ganho prematuro, mudança de organização/cliente/moeda, ajuste local de valor/composição e reversão/reabertura após aprovação. Incluem os caminhos existentes de etapa e `ajustar_pedido_ganho`, além de recusar uma segunda venda ativa pelo escritor legado; pedidos sem operação conservam seu comportamento.
- Admissão e primeiro envio verificam se o caminho canônico até a Carteira está disponível. A conciliação só termina quando o espelho pertence ao cliente correto, está aprovado e tem o total confirmado. Ausência ou divergência do espelho desfaz os efeitos locais da tentativa e conserva a aprovação para recuperação.
- Proteção de identidade na importação: IDs de operações novas não passam pelo gravador legado; a verificação em TypeScript e o trigger SQL compartilham a mesma regra. Pedido histórico existente antes da vinculação permanece intacto e bloqueia a operação para conferência.
- Painel de situação separado do formulário. Atualizar a situação lê apenas o banco local, sem chamar o ERP ou descartar rascunho não salvo. Perda de acesso oculta dados em cache; respostas inválidas ou de outro negócio não são aceitas. Divergência comercial posterior aparece como conferência necessária, sem apresentar a aprovação antiga como atual.

## O que continua fechado

`toth_order_private.preorder_runtime_ready()` retorna `false`. Mesmo um administrador com revisão válida recebe `toth_write_contract_unverified`; não se cria uma operação sem capacidade de executá-la. O frontend mantém envio indisponível.

`createUnavailableTothPreorderAdapter()` informa criação/consulta indisponíveis e não contém URLs, credenciais ou chamadas HTTP. A variável `TOTH_PREORDER_SEND_ENABLED=true` não torna o adaptador disponível nem abre a admissão SQL. Flags do navegador também não abrem essas barreiras.

Não há cron, webhook ou busca automática de operações. A função interna processa um ID existente por chamada. O agendamento, a frequência de consulta, os alertas e o disparo após submissão serão ligados junto do contrato verificado. Não usar o cliente HTTP de leitura com seus retries para criar pedidos.

Alteração, cancelamento e solicitação de rejeição não têm comando implementado: a Toth não ofereceu essas APIs. Divergência de estado/total após aprovação bloqueia a conciliação para conferência; não reverte ou ajusta uma venda automaticamente. A resolução dessas pendências e as decisões 15–17 do roadmap permanecem trabalho futuro. Rejeição inicial não muda o negócio para perdido nem libera outro pedido no mesmo negócio.

## Fluxo e autenticação

1. `toth_request_order_send(deal_id, expected_revision)` deriva a organização e o autor do contexto autenticado, exige revisão atual e congela o snapshot. Hoje a barreira fechada impede a admissão.
2. `toth-process-preorder` aceita apenas POST JSON com `operation_id`; exige `x-cron-secret` antes de ler o corpo e limita o JSON a 1 KiB. `verify_jwt=false` no config é acompanhado dessa autenticação própria. JWT de usuário ou `organization_id` no corpo não substituem o segredo.
3. As RPCs de serviço reservam uma operação por 120 segundos. A identidade da organização piloto vem da linha persistida, não do chamador. Reserva expirada em `sending` conserva esse estado para recuperação por consulta.
4. O engine valida snapshot, organização, token e validade da reserva antes da chamada. Criação só ocorre após a transição persistida; qualquer resultado inconclusivo passa a exigir consulta. Perda da resposta do banco também não autoriza nova criação.
5. O futuro adaptador precisa normalizar uma observação verificada com identidade, origem, estado, total e ordem confiável do fornecedor. `source_order` não é uma versão de pedido presumida: exige sequência ou timestamp documentado com garantias suficientes. Horário local, contador de consultas e simples ordem de chegada não servem.
6. Observação aprovada é persistida antes da conciliação. A conciliação atualiza o negócio e usa os triggers canônicos para emitir a venda. Repetir confirmação/recuperação não emite outra venda. Conflito com venda existente, lead, cliente ou total bloqueia.
7. O painel consulta `toth_preorder_workspace` autenticado e recebe somente estado público. Snapshot, reserva e dados brutos do fornecedor não são expostos. Tabelas novas não concedem acesso direto, inclusive ao serviço.

As funções internas têm `search_path` fixo, grants explícitos e escopo de organização. Ser master sem vínculo ativo não concede acesso ao piloto. A configuração atual mantém os novos envios fechados, enquanto o engine permite recuperar uma aprovação já persistida sem depender de envio habilitado.

## Arquivos principais

| Área | Arquivo |
|---|---|
| Migração da fundação | `supabase/migrations/20271021000016_toth_order_drafts.sql` |
| Operações, auditoria e travas | `supabase/migrations/20271021000021_toth_preorder_operations.sql` |
| Processador e fronteiras | `supabase/functions/_shared/erp/toth-preorders/` |
| Entrada interna | `supabase/functions/toth-process-preorder/index.ts` |
| Integração com importação existente | `supabase/functions/toth-sync-pedidos/index.ts` |
| Interface | `src/modules/integrations/components/TothPreorderStatusPanel.tsx` |
| Harness SQL | `tests/integration/toth-preorder-operations.test.mjs` |

A migration 021 foi criada pela CLI e renumerada antes de qualquer aplicação para ficar após a cadeia existente até 020. Não modifica migration aplicada nem faz backfill de dados comerciais.

## Antes de liberar

Obter da Toth o contrato de criação e consulta por identificação da operação, relação pré-pedido/pedido, status exatos, totais e ordenação de mudanças. Confirmar quais serviços existem e quais serão desenvolvidos no Flow. O “Sim” sobre idempotência não substitui teste de duas chamadas simultâneas e resposta perdida.

Completar catálogo/snapshot comercial com preço autorizado, condições, empresa/filial, representante, endereço, frete e validações efetivas da Café. O snapshot atual de cliente/itens/revisão não presume esses campos nem está apto a virar um payload comercial por simples abertura da flag.

Disponibilizar homologação isolada do ERP com a Toth; requisitos e custos de VM ainda precisam ser definidos. Testar criação, consulta, rejeição, aprovação, perda de resposta, concorrência, credenciais insuficientes e preservação dos cadastros. O banco isolado do CRM não isola efeitos do ERP.

Validar as migrations e todos os triggers no schema completo do alvo de teste, incluindo `has_function_privilege` para anon/authenticated/service_role e chamadas positivas/negativas por organização. O harness local usa papéis PostgreSQL reais e padrões de grants, mas substitutos de identidade e schema reduzido; não comprova ACL ou concorrência de múltiplas sessões no alvo real.

Após revisão e autorização do ambiente, aplicar migrations na ordem correta com barreiras fechadas, publicar funções/frontend, regenerar tipos e só então ligar adaptador, despacho, acompanhamento e envio manual revisado. Não executar `db push` sobre toda a cadeia sem conferir o alvo e dependências. Merge em `main` publica o frontend automaticamente e é uma ação distinta da aplicação das migrations/funções.

## Validação desta entrega

| Verificação | Resultado |
|---|---|
| Vitest: pré-pedidos, rascunhos, interface, prévia e importação Toth | **561 testes passaram em 22 arquivos** |
| SQL de pré-pedidos, incluindo engine → repository → RPC real | **47 testes passaram** |
| SQL da fundação de rascunhos | **25 testes passaram** |
| `typecheck:ratchet` e `lint:ratchet` | Passaram, zero erros/problemas introduzidos; baselines não alterados |
| `deno check --no-lock` das funções `toth-process-preorder` e `toth-sync-pedidos` | Passou |
| Build do frontend e service worker | Passou |
| YAML do workflow de CI | Válido; as duas suítes SQL Toth foram incluídas antes do ratchet de testes |

Os 47 testes SQL de operações usam as funções reais do caderno, captura de etapa e ajuste de pedido do repositório, com schema/identidade de teste e dados fictícios. Incluem papéis reais, isolamento, grants, snapshot imutável, reserva vencida, perda de resposta, aprovação seguida de falha local, conflito com importação histórica e regressões dos caminhos comerciais existentes. As definições canônicas de produção foram consultadas apenas como metadados para conferir as fixtures, sem escrita remota.

Não há validação de escrita em ERP real, QA visual autenticado ou homologação do schema completo nesta entrega. PGlite não comprova corrida entre sessões PostgreSQL independentes; lease/CAS, interleavings determinísticos e locks SQL foram testados/revisados, mas a concorrência real permanece caso obrigatório de homologação.

Após integrar a `main` em `33f1424d` e corrigir os ciclos novos com APIs públicas estreitas, `lint:deps:check` passou com zero violações novas e baseline intacta. A suíte geral não ficou verde: as mesmas 15 falhas em 70 casos foram reproduzidas na `main` isolada e no PR, sem diferenças de nome ou primeira mensagem. O [relatório de QA](qa-toth-pr-2133-2026-09-21.md) registra as correções, evidências e limites da validação final.

A revisão independente confirmou a exceção de `toth_mark_preorder_sending` no guard master-ghost: execução exclusiva de serviço e consulta a `team_members` para revalidar o autor original, não para resolver a organização do chamador. Um bypass master permitiria envio após perda de autorização do autor. Apenas esse nome foi acrescentado ao baseline; os 24 achados e 42 entradas obsoletas herdados permanecem reportados.

O histórico da fundação, a dívida dos verificadores gerais e o bloqueio anterior de GitHub Actions por cobrança/limite de gastos estão documentados na [spec](../../.specs/features/toth-order-drafts.md). Nenhum baseline geral foi ampliado para esconder falhas.
