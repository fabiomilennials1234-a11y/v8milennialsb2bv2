# SCRUM-694 — Inventário frontend da identidade comercial

Data: 2026-09-10. Base examinada: `develop`, commit `215ff0bb9`, worktree `torque-scrum-681-audit`. Subtarefa documental da SCRUM-681. Nenhuma implementação, migration, acesso ao banco ou validação em produção nesta análise.

## Resultado

Frontend executável continua centrado em `leads`. A estrutura de contatos/empresas existe nos tipos gerados, mas não corresponde a um módulo de cadastro navegável encontrado nesta base. Negócio já possui identidade em `deals` e posição em `pipeline_entries`; a interface ainda depende de um lead para abrir, localizar, autorizar e enriquecer esse negócio. Portanto, habilitar empresa como único vínculo de negócio exige revisar contratos e estados vazios dos componentes, além de renomear telas.

Premissas recebidas, não rediscutidas: Contatos substituem Leads; empresa opcional; N:N contato–empresa; negócio com 0..1 empresa e vários contatos; preservar experiência dos funis; piloto Milennials e TorqueCRM; empresas com nomes diferentes permanecem distintas. Esta auditoria não escolhe identidade canônica, política de autorização nem estratégia de migração.

## Método e limites da evidência

Leitura de código TS/TSX e contexto JIT `src/modules/CLAUDE.md`, `leads/CLAUDE.md`, `pipelines/CLAUDE.md`, `carteira/CLAUDE.md`, com skill engenheiro aplicada somente a auditoria/documentação. Busca textual de `lead_id|leadId|from("leads")` em TS/TSX de `src/modules`, excluindo nomes `*.test*` e `types.ts`, localizou referências em 299 arquivos: leads 104, communication 65, pipelines 36, engagement 25, carteira 18, analytics 14, campaigns 13, platform 10, copilot 6, workflows 5, identity 2, integrations 1.

Contagem é indicador de alcance textual, não número de arquivos a alterar: inclui comentários, declarações e código sem caminho de execução comprovado. Marketing/billing sem correspondência nesse padrão não significa ausência de impacto indireto. Não foi produzido call graph exaustivo, nem executada UI; referências abaixo são âncoras verificadas por leitura estática.

## Matriz de superfícies executáveis

| Superfície | Evidência do checkout (arquivo:linha) | Impacto e questão para planejamento |
|---|---|---|
| Rotas e navegação | `src/App.tsx:449` registra `/leads`, protegida por feature `leads` em `src/App.tsx:454`; `src/modules/platform/lib/navigation-model.ts:116` mostra Leads; `src/modules/platform/lib/navigation-model.ts:260` exige `leads.view` | Definir URLs e redirecionamentos, navegação Empresas e gates do piloto. Disponibilidade a todos não determina quem pode ler dados. |
| Rotas relacionadas | `src/App.tsx:461` lixeira, `src/App.tsx:473` duplicatas, `src/App.tsx:610` WhatsApp, `src/App.tsx:652` carteira, `src/App.tsx:666` funil | Rever deep links, retorno de modal, links salvos e jornadas fora da lista principal. |
| Lista/cadastro | `src/modules/leads/pages/Leads.tsx:340` consulta leads; `src/modules/leads/pages/Leads.tsx:1033` campo Empresa é input textual; `src/modules/leads/pages/Leads.tsx:494` hidrata `lead.company` | Input de texto não representa N:N. Definir criação/seleção de empresa, revisão de nomes e apresentação de múltiplos vínculos sem empresa principal obrigatória. |
| Formulário com entrada em funil | `src/modules/leads/pages/Leads.tsx:567` cria posições usando `newLead.id`; sistemas e custom têm caminhos distintos até linha 573 | Preservar experiência requer verificar cada caminho; não assumir que único novo modal cobre todas as entradas. |
| Lista + resultados comerciais | `src/modules/leads/pages/Leads.tsx:357` carteira, linha 359 vendas, linha 361 negócios, linha 368 recompra | Trocar identidade muda junções e agregações; definir se métricas por contato incluem compras em nome de empresas. |
| CRUD | `src/modules/leads/hooks/useLeads.ts:102` consulta `leads`, linha 252 cria, linha 293 atualiza, linha 385 exclusão via `bulk_delete_leads` | Definir camada de compatibilidade e efeitos de excluir contato com relações. Renomear TS sem contrato backend não resolve. |
| Detalhe de pessoa | `src/modules/leads/components/lead-detail/hooks/useLeadDetail.ts:42` consulta visibilidade, linha 74 lê leads, linha 104 lê `negocio_projetado` por lead e linha 119 follow-ups | Separar histórico do contato das participações em negócios; definir contexto de empresa e histórico após mudança de vínculo. |
| Criar negócio | `src/modules/leads/components/lead-detail/modal/pipes/useAbrirNegocio.ts:71` lança erro sem lead; linha 112 repete guarda para custom e linha 127 envia `lead_id` | Empresa sem contato não funciona por este contrato. Precisará decisão explícita de entrada contact/company/both e roteamento preservado. |
| Novo negócio visual | `src/modules/leads/components/lead-detail/modal/pipes/NewDealDialog.tsx:251` informa herança de dados do lead; `src/modules/leads/components/lead-card/LeadCardNewDeal.tsx:50` usa gates do lead | Revisar textos, valores herdados, participantes, empresa compradora e permissões. Comentário do modal sobre RPC é documentação; guards anteriores são código executável. |
| Localização de negócios | `src/modules/leads/hooks/useLeadsDeals.ts:126` consulta entries, linha 129 filtra por lead, linha 275 ignora entries sem lead/pipeline, linha 335 lê vendas históricas por `source_lead_id` | Negócio só de empresa pode desaparecer da projeção atual. Definir listagem independente e preservação das vendas históricas sem entry. |
| Painel de negócio | `src/modules/leads/components/deal-detail/DealPanelProvider.tsx:18` abre por entry + lead; `src/modules/leads/components/deal-card/useDealCardData.ts:62` carrega detalhe do lead, linha 94 encontra negócio no mapa daquele lead, linha 150 consulta atividades por lead | Identidade visual não pode continuar dependendo exclusivamente da pessoa para empresa-only; risco de histórico compartilhado indevidamente entre oportunidades da mesma pessoa. |
| Funis | `src/modules/pipelines/hooks/model/usePipelineEntries.ts:244` faz join `leads!pipeline_entries_lead_id_fkey`; `src/modules/pipelines/hooks/model/usePaginatedFunil.ts:93` consome RPC paginada | Rever projeção consumida pelo cartão e RPC sem eliminar garantias de paginação e filtros. Preservar funis não equivale a manter join obrigatório com lead. |
| Seleção em massa | `src/modules/leads/hooks/useBulkActions.ts:53` envia `p_lead_ids`; linha 191 seleciona entries por `lead_id` | Contato em vários negócios gera ambiguidade de seleção; comentário em linha 170 reconhece seleção do Kanban por lead. Definir identidade selecionável por contexto antes de migrar ações destrutivas. |
| Importação/exportação | `src/modules/leads/hooks/useImportLeads.ts:322` documenta campos custom; `src/modules/leads/hooks/useExportLeads.ts:119` gate `export_leads`, linha 212 lê leads, linha 259 consulta entries | Planejar formatos CSV, múltiplas empresas, preview, falhas parciais e compatibilidade. Política de nome exato deve aparecer na UX de importação. |
| Agenda/seletor | `src/modules/engagement/components/agenda/LeadPorFunilPicker.tsx:251` busca paginada, linha 261 hidrata selecionado, linha 294 abre desempate, linha 309 fixa negócio | Já distingue múltiplos negócios de um lead. Preservar desempate e busca server-side ao adicionar empresa; não substituir por lista limitada em memória. |
| Atividades | `src/modules/engagement/hooks/useActivities.ts:69` passa contato, linha 70 empresa, linha 72 lead; criação equivalente em linhas 169–172 | Contrato parcialmente preparado não comprova consumidores completos. Decidir propriedade da atividade e visualização em diferentes timelines. |
| WhatsApp | `src/modules/communication/hooks/chat/useWhatsAppContacts.ts:186` mapeia `lead_id`, linha 227 consulta mensagens com lead, linha 336 enriquece via leads, linha 410 resolve contato pelo telefone | “Contacts” no nome do hook significa contatos de conversa, não CRUD da tabela contacts. Rever resolução de identidade e ambiguidade, preservando canais e mensagens. |
| Meta/WhatsApp oficial | `src/modules/communication/hooks/chat/useSocialContacts.ts:38` e `src/modules/communication/hooks/chat/useOfficialWhatsAppContacts.ts:36` usam keys de contatos sociais | Não tratar todas as listas como mesmo schema. Resolver vínculos precisa cobrir cada provedor e o compartilhamento de cache. |
| Campanhas/disparos | `src/modules/campaigns/hooks/useAudienceResolve.ts:60` fixa lead IDs; `src/modules/campaigns/hooks/useBlastPlanRecipients.ts:69` join leads; `src/modules/campaigns/hooks/useDispatchQueueItems.ts:37` lê contatos via FK de lead | Definir destinatário por pessoa/canal, seleção por empresa e deduplicação; vários participantes não podem multiplicar disparos por acidente. |
| Workflows | `src/modules/workflows/hooks/useAutoFollowUp.ts:46` envia lead_id; `src/modules/workflows/hooks/useWorkflows.ts:267` replica lead em execução; `src/modules/workflows/hooks/useAutomationHealth.ts:83` lê execuções por lead | Revisar editor, reexecução e diagnóstico quando alvo muda de entidade. Sem definição de alvo, frontend não pode traduzir somente labels. |
| Copilot | `src/modules/copilot/hooks/useAgentMetrics.ts:129` lê lead_id; linha 133 conta IDs únicos; linha 236 incorpora lead com empresa textual; `src/modules/leads/hooks/useLeads.ts:634` controla IA pelo lead | Planejar seletor de contexto, pausa humana e métricas com novas relações. IA de uma pessoa em duas empresas exige contexto sem vazamento. |
| Carteira | `src/modules/carteira/hooks/useUpsellClientByLeadId.ts:25` filtra por lead e key na linha 17 | Definir identidade de cliente/conta e o que abrir a partir de contato ou empresa, sem duplicar receita e pedidos. |
| Analytics | `src/modules/analytics/hooks/useOutboundMetrics.ts:46` conta leads; `src/modules/analytics/hooks/useConversasAguardando.ts:172` enriquece por leads | Métrica precisa de denominador explícito e compatibilidade histórica; dashboard não se corrige apenas com renomeação. |
| Integração frontend | `src/modules/integrations/hooks/useGoogleCalendar.ts:39` contrato contém lead_id; `src/modules/platform/hooks/useGlobalShortcuts.ts:38` atalho abre /leads | Calendário, atalhos e navegação precisam seguir compatibilidade; contratos externos API/Make ficam no inventário do pai. |

## Cache, realtime e autorização

- `src/modules/leads/hooks/useLeads.ts:81` assina leads; linhas 82–84 assinam deals, entries e sale_events para invalidar lista/contagem. Key paginada inclui organização e filtros na linha 91. Atualização invalida também detalhes e funis em linhas 337–339. Precisará mapa explícito de invalidação de contatos, empresas, relações e participantes.
- `src/modules/leads/components/lead-detail/hooks/useLeadDetailRealtime.ts:87` assina leads; linhas 100, 114, 127, 140 e 153 assinam histórico, comentários, tags, entries e itens. Relações N:N não estão cobertas por essas assinaturas.
- `src/modules/pipelines/hooks/model/usePaginatedFunil.ts:91` mantém key de página por organização; linha 315 invalida páginas, contagens e compatibilidade. Mudança de nome/participante da empresa precisa atualizar cartões sem carregar todos os negócios.
- `src/shared/realtime/useRealtimeSubscription.ts:129` decide filtro por organização com exceções de tabela. Novas tabelas devem ser avaliadas nesse transporte, sem presumir isolamento apenas pela UI.
- `src/modules/leads/components/lead-detail/hooks/useLeadActionGates.ts:53` usa `delete_lead`; linha 55 `create_lead`; linha 87 nega ações sem lead. Empresa-only depende de redesign desse contrato.
- `src/modules/identity/permissions/lib/leadVisibility.ts:40` define chaves `leads.view_all`, `view_unassigned`, `view_subordinates`. Seus comentários sobre RLS são pistas para investigação do banco, não prova de comportamento no ambiente.
- Algumas keys de detalhe são só por ID (`useLeadDetail.ts:70`). Não foi comprovado vazamento; planejamento deve verificar limpeza de cache em troca de organização e ids após migração, inclusive piloto misto.

## Separação entre tipos, docs e execução

`src/integrations/supabase/types.ts:3604` contém companies, linha 4034 contacts, linha 6849 deal_contacts e linha 7014 deals. Tipos gerados não provam migrations aplicadas, dados migrados ou interface ativa. Busca em TS/TSX executável, excluindo `types.ts` e testes, não encontrou `.from("contacts")`, `.from("companies")` ou acesso funcional a `deal_contacts`; esta é evidência negativa limitada ao padrão textual, não prova universal de ausência (RPCs podem acessá-las).

`src/modules/carteira/CLAUDE.md` cita hook `useDeals` e dívida Deal vs Proposta, mas `src/modules/carteira/hooks/useDeals.ts` **não existe nesta base**. Referência desse arquivo na conversa anterior não é reutilizável como evidência atual. `src/modules/CLAUDE.md` ainda contém classificação skeleton; código executável e commit prevalecem sobre status histórico do documento. Testes existentes citados abaixo também não comprovam comportamento atual em runtime sem execução.

## Perguntas para grill-with-docs

1. Quais dados e permissões permanecem no contato, quais pertencem ao vínculo com empresa e quais ao negócio? Cargo, responsável, qualificação, campos custom, consentimento e histórico precisam de casa explícita.
2. Como negócio sem contato abre no painel e nas ações hoje bloqueadas por `no_lead`? Que identidade carregam deep links, seleção do Kanban e ações em massa?
3. Que histórico aparece na empresa e em cada negócio quando contato participa de várias empresas/oportunidades? Como manter autoria, escopo de visibilidade e contexto antigo?
4. Como selecionar empresa compradora ao abrir pela pessoa, pela empresa, pelo WhatsApp e pelo funil? Como desfazer associação errada sem mover histórico automaticamente?
5. Quais rótulos/URLs/contratos permanecem compatíveis durante piloto, e como interface lida com organizações migradas e não migradas?
6. Na importação, o que “nome diferente” significa para espaços, maiúsculas, acentos e vazio? Não normalizar nem agrupar sem decisão que preserve regra do CTO.
7. Como projetar Empresas com paginação, pesquisa, ordenação e agregações autorizadas, evitando N+1 e fan-out de dados do contato?
8. Quais ações devem migrar de seleção por lead para seleção por entry/deal, sem mudar a rotina do funil nem atingir outros negócios da mesma pessoa?
9. Como atualizar métricas e carteira com a nova identidade preservando significado histórico? Contato comprador e contato participante não são necessariamente receita atribuída à pessoa.

## Critérios propostos para planejamento de validação (não testes executados)

- Contato sem empresa: criar, editar, conversar, abrir negócio, ganhar/perder, recomprar.
- Empresa sem contato: criar negócio e usar painel/cartão sem falhar em guards de lead.
- Contato em duas empresas: selecionar empresa da oportunidade; negócio pessoal continua sem empresa.
- Dois participantes + dois negócios: seleção, atividade, checklist, produto e receita não duplicam nem vazam contexto.
- Importar/exportar com nomes diferentes por uma letra, nomes idênticos em organizações diferentes e relações múltiplas; validar preview e histórico.
- Pessoa com acesso a um negócio e sem acesso a outro não vê contexto proibido por agregação da empresa.
- Alternar organização piloto/não piloto; verificar keys, realtime, shortcuts, links salvos e estado de modal.
- Preservar busca paginada, mobile, teclado, foco, carregamento, vazio, erro, falha parcial e feedback de permissão.

Testes existentes úteis como ponto de partida: `src/modules/leads/components/lead-detail/modal/pipes/__tests__/NewDealDialog.test.tsx`, `src/modules/leads/components/deal-detail/__tests__/DealDetailDialog.test.tsx`, `src/modules/leads/components/lead-detail/hooks/__tests__/useLeadDetail.test.ts`, `src/modules/leads/components/lead-detail/hooks/__tests__/useLeadDetailRealtime.test.ts`, `src/modules/pipelines/hooks/model/usePaginatedFunil.test.tsx`, `src/modules/identity/permissions/lib/leadVisibility.test.ts`, `src/modules/platform/components/layout/Sidebar.rotas.test.tsx`. Conteúdo/cobertura não auditados integralmente; não executados nesta fatia documental.
