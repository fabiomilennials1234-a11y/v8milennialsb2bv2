# Etapa 0 — escrita no Toth / Café Jurerê

Levantamento em 2026-09-17. Base examinada: `c99515b5072407c938d174853e7219b43b13c717`.

**Estado: levantamento local realizado; etapa 0 aberta por dependências externas.** Nenhum endpoint do ERP foi chamado, nenhuma credencial foi acessada, nenhuma sincronização, migration ou escrita em produção foi executada. Existência de código não comprova implantação. Comentários com medições antigas são contexto histórico, não nova medição.

- [Matriz de capacidades e contrato](matriz-capacidades.md)
- [Solicitação pronta para o fornecedor — não enviada](solicitacao-fornecedor.md)
- [Roadmap e decisões do CTO](../cafe-jurere-escrita-erp-roadmap.md)

## Atualização do fornecedor em 21/09/2026

[Resposta encaminhada pelo usuário e análise de impacto](resposta-fornecedor-2026-09-21.md). A Toth informou que a API recebe **pré-pedidos**, aprovados ou rejeitados na empresa; não ofereceu comandos de alteração/cancelamento. Não existe homologação na Café, e o fornecedor propõe instalação se uma VM for disponibilizada. Os serviços disponíveis versus os que precisam ser criados no padrão Flow ainda devem ser distinguidos. O próprio fornecedor ressalvou a falta de confirmação da configuração exata da Café.

O usuário confirmou nesta conversa: **ganho no CRM somente após aprovação no ERP, com status confirmado pela integração**. Recebimento técnico não representa aprovação. A fundação local não precisa mudar seu comportamento para manter essa separação: ela não envia pedidos nem marca ganho.

A matriz foi atualizada com capacidade declarada, ausência declarada e lacunas de contrato. Duplicidade/consulta receberam apenas um “Sim”, sem mecanismo comprovado; catálogo, permissões e efeitos por fase continuam pendentes. A etapa 0 permanece aberta. [Complemento ao fornecedor, pronto para revisão e encaminhamento pelo responsável](complemento-fornecedor-2026-09-21.md).

Esta atualização altera apenas documentação. Não envolve provisionamento de VM, contato com o fornecedor, merge, deploy, aplicação de migration ou ativação de flag. O inventário e os resultados locais abaixo são evidências de 17/09, não novas verificações do ambiente real.

## Inventário comprovado no checkout

| Evidência | Comportamento observado | Consequência para escrita |
|---|---|---|
| `supabase/functions/_shared/erp/toth-client.ts`, métodos `login`, `get`, `postForm`, `authedRequest` | Serviço legado: login por formulário, token em query por padrão; transporte por header configurável; repete uma chamada após erro de autenticação | POST de consulta não prova suporte à inclusão. Política de repetição não deve ser reutilizada para escrita sem garantia do fornecedor |
| `supabase/functions/_shared/erp/toth-flow-client.ts`, `login`, `postEnvelope` | Outro serviço/gateway: login em `auth`, JSON e Bearer; repetição após erro de autenticação | Especificar se a escrita será no gateway ou diretamente no Toth e quem garante a atomicidade |
| `supabase/functions/toth-sync-clientes/index.ts:214`, `:417` | GET `clientes` | Consulta e importação existentes; não cadastro remoto |
| `supabase/functions/toth-sync-cobrancas/index.ts:293` | POST de formulário em `cobrancas` para consulta | Não é escrita financeira |
| `supabase/functions/toth-sync-pedidos/index.ts:379` | POST `pedidos` via Flow, com janela, documento e paginação; usa `upsertCanonicalOrder` | Leitura remota seguida de escrita local. Não executar como sondagem sem considerar seus efeitos no CRM |
| `supabase/functions/_shared/erp/toth-pedidos-montagem.ts`, `mesclarFatias` | Junta itens de um mesmo pedido repartido entre páginas | Uma página não é necessariamente um pedido completo; não usar fatia como versão para edição |
| `supabase/functions/_shared/erp/toth-pedidos-window.ts:20`, `resolvePedidosWindow` | Janela padrão de 90 dias; configuração e overrides | Não garante detectar mudança tardia em pedido antigo. Contrato precisa de consulta exata ou incremental por alteração |
| `supabase/functions/_shared/erp/toth-provider.ts`, `capabilities` | Manifesto declara apenas clientes e recebíveis, apesar de existir sync de pedidos | Manifesto e comentários estão defasados em relação ao código; não inferir ausência de leitura de pedidos a partir deles |
| `supabase/migrations/20270821140000_toth_cron_sync.sql:85` | Agenda no SQL: clientes `0 6 * * *`, cobranças `15 */2 * * *` | Agendamento no arquivo não confirma cron ativo. Busca por `toth-sync-pedidos` nas migrations não encontrou seu agendamento; frequência real pendente |
| `supabase/functions/_shared/erp/erp-admin-auth.ts`, `resolveAdminOrg` | Valida usuário via Auth, resolve organização em `team_members`, compara role com admin/master | HERDADO: inclui `master` na comparação de role, em conflito com o vocabulário atual do projeto. A futura escrita deve exigir admin da organização e tratar master separadamente, conforme decisão explícita |

Não foi identificado nos arquivos Toth examinados um handler de criação, atualização ou cancelamento remoto de pedidos, nem catálogo comercial completo com precificação. Isso não prova que o fornecedor não possua essas APIs.

## Regras comerciais existentes e pontos de integração

1. **Desfecho do negócio:** `supabase/migrations/20270918000070_o_botao_pode_informar_o_valor.sql`, `definir_desfecho_da_entrada`, retorna cedo se o desfecho já é o solicitado. Usa `COALESCE(value, p_valor)`: não substitui um valor já existente pelo total confirmado no ERP. Não basta chamar essa RPC para reconciliar total e desfecho.
2. **Caderno de vendas:** `supabase/migrations/20270904000000_desfecho_do_negocio.sql:280`, `fn_deal_outcome_para_caderno`, reage à troca de `deals.outcome` e chama `_registrar_desfecho_no_caderno`, que produz eventos de venda/reversão. O novo fluxo precisa preservar a semântica e não inserir uma venda adicional por fora.
3. **Ajuste de negócio ganho:** `supabase/migrations/20271021000006_ajustar_pedido_ganho.sql:72`, `ajustar_pedido_ganho`, bloqueia vínculo ERP, exige revisão e motivo, ajusta com reversão/substituição mantendo histórico. É referência de invariantes; não é API reutilizável diretamente para o Toth. `docs/changes/2026-09-14-ajustar-pedido-ganho.md` explica o espelho da Carteira.
4. **Importação de pedidos:** `supabase/functions/_shared/erp/sync/upsert-order.ts`, `approvalForErpStatus` e `upsertCanonicalOrder`, grava `upsell_orders`, com identidade local `(organização, origem, ID externo)`. FATURADO/APROVADO → aprovado; CANCELADO/DEVOLVIDO → rejeitado; demais estados → pendente. Ausência de status aprova por compatibilidade genérica. Essa tolerância não serve como confirmação de escrita ou permissão de edição.
5. **Duas representações da venda:** o negócio ganho pode ter espelho `external_source='funnel_sale_event'`; o importado tem `external_source='toth'`. **Risco de duplicidade a resolver antes do piloto**, não prova de duplicidade atual. Definir vínculo explícito e regra de conciliação por pedido originado no novo fluxo, mantendo as regras históricas intactas. Pedido definitivo criado não equivale a faturado: preservar a distinção entre ganho comercial e estado operacional.
6. **Cliente ambíguo:** `supabase/functions/_shared/erp/sync/order-store.ts`, `findClientIdByCnpj`, escolhe a linha mais recente quando há mais de uma. HERDADO: estratégia de importação que não atende à decisão de bloquear ambiguidades na escrita. Novo envio exige vínculo inequívoco e escopo empresa/filial confirmado.
7. **Itens importados:** o mesmo store usa delete/insert em chamadas separadas e identidade por posição (`line_no`). Essa identidade não comprova o ID da linha no ERP. `writeItems` no upsert ignora listas vazias. HERDADO: não reutilizar como garantia transacional da confirmação nem como contrato para remover itens remotamente.
8. **Proteção dos históricos:** `src/modules/carteira/CLAUDE.md` registra proteção de ERP na RPC e uma lacuna histórica em RLS. Estado atual da base não verificado. Antes de liberar a nova superfície, testar chamada direta e políticas reais; ocultar botão não satisfaz a proteção exigida.

Nenhum desses achados justifica alterar os fluxos existentes durante a etapa 0. São requisitos de desenho e verificação nas próximas etapas.

## Identificadores e dados

O mapeador `toth-mappers.ts` usa código de cliente quando disponível e documento como alternativa; pedidos têm número, situação, total líquido, emissão e itens com código, descrição, quantidade e valor unitário. Campos aceitos por um mapeador tolerante não constituem contrato obrigatório do fornecedor.

Precisamos firmar: unicidade do número do pedido entre empresas/filiais, IDs estáveis de itens, ID de correlação da operação, revisão do pedido e moeda/arredondamento. Um código de produto encontrado em itens históricos não comprova catálogo ativo, estoque ou preço autorizado.

## Encerramento da etapa 0

| Pendência | Responsável proposto | Evidência exigida |
|---|---|---|
| API e garantias de escrita | Fornecedor Toth/gateway | Distinguir APIs existentes/a desenvolver; contrato de pré-pedido, consulta, aprovação, catálogo e casos da matriz |
| Homologação isolada | Fornecedor + TI Café Jurerê | Requisitos/licenças/custo/prazo da VM a disponibilizar, responsabilidades, credenciais próprias por canal seguro, dados e efeitos isolados |
| Transporte e permissões | TI Café Jurerê + fornecedor | Configuração atual confirmada e canal protegido para escrita; credencial de escopo mínimo |
| Estados e regras comerciais | Operação Café Jurerê + fornecedor | Configuração efetiva da Café: recepção/análise/aprovação/rejeição, identidade pré-pedido/pedido, totais e efeitos de estoque/financeiro/fiscal |
| Reconciliação e venda única | Engenharia | Desenho de identidade negócio/pedido/Carteira/caderno, inclusive negócio já ganho e eventos fora de ordem |
| Frequência e atendimento de pendências | CTO/Operação + fornecedor | Limites da API, prazo de atualização aceito e responsável pelas pendências |
| Administração de alterações/cancelamentos | CTO | Confirmar que a regra de admin da organização abrange ambas as ações |
| Escopo do piloto e rejeição comercial | Usuário/operação + engenharia | Confirmar primeira liberação de pré-pedidos/acompanhamento; definir efeito da rejeição, correção/substituição e vínculo exclusivo por negócio |

Critério: cada capacidade essencial deve ter contrato e evidência suficientes para desenhar e testar a solução. Contrato acordado não equivale à homologação das etapas posteriores. Lacuna essencial mantém a operação afetada bloqueada. Não há prazo firme de implementação enquanto as dependências do fornecedor estiverem abertas.

## Validação local

Suíte existente selecionada: clientes HTTP Toth, mapeadores, URLs, janelas, montagem de páginas e upsert de pedidos. Execução usa mocks; não comprova funcionamento remoto ou implantação.

Comando executado: `npx vitest run tests/unit/shared-erp-toth tests/unit/toth-sync-pedidos-montagem.test.ts tests/unit/toth-endpoint.test.ts tests/unit/shared-erp-upsert-order.test.ts --reporter=dot`.

Resultado: **12 arquivos, 270 testes passaram**, em 21,68 segundos. Não foram adicionados testes nem alterado código operacional. Não foram executados testes contra banco ou ERP real. Aviso preexistente do Vite sobre uso de `__dirname` no carregador de configuração futuro, sem falha da suíte.
