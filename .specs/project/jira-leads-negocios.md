# Leads & Negócios — inventário de tarefas (projeto TOR)

Gerado em 2026-08-05 a partir do repo (commits, PRs, migrations, testes, specs e ADRs), com verificação cética item a item.

**Régua de status:** `Concluído` = entregue e sem lado de produção a aplicar (docs, ADRs, ensaios) · `Testado` = provado (teste verde ou prova em branch efêmera), mergeado em `develop` · `Testar` = escrito e mergeado, sem prova · `Fazendo` = em branch/PR aberta · `A fazer` = nada escrito.

**Mapa para o workflow do TOR** (que não tem Testar/Testado): `Testado` e `Testar` entram na coluna **Testando**, separados pelas labels `status:testado` e `status:testar`. As outras três casam 1:1.

**Chave de inventário.** Cada item carrega uma label estável (`inv:EPIC`, `inv:H3`, `inv:H3-04`). É ela que torna a criação idempotente: buscar por `labels = "inv:H3-04"` antes de criar, e atualizar em vez de duplicar. Nunca renumerar — item que sai vira riscado, item novo pega o próximo número da story.

> ⚠️ **Nada desta feature está em produção.** Nem migration, nem edge function, nem front. `develop` não deploya.

## H1 · Fatia 1 — separação Lead↔Negócio na interface

`inv:H1` · Concluído: 1 · Testar: 3 · Testado: 4

| Chave | Coluna TOR | Régua | Subtask | Evidência / nota |
|---|---|---|---|---|
| `inv:H1-01` | Concluído | Concluído | Protótipo clicável do redesenho da aba de Funis | PR #1313 · .specs/mockups/funis-redesign/ — artefato de design, sem lado de produção |
| `inv:H1-02` | Testando | Testar | Lista de Leads vira cartões com cluster de carteira | 56b17831 · PR #1315 · useLeadsCarteiraMetrics lê upsell_clients — sem teste automatizado |
| `inv:H1-03` | Testando | Testar | Leads sobe pra topbar; Combustível e Carteira saem do menu | dd264db6 · PR #1315 — /upsell segue viva por link direto |
| `inv:H1-04` | Testando | Testado | Aba Leads ganha a coluna Negócios (useLeadsDeals) | eca2ff36 · PR #1315 — valor, etapa, estado e tempo parado por negócio |
| `inv:H1-05` | Testando | Testado | Card do funil abre o Negócio; modal do Lead num lugar só | 16e410ae · PR #1315 — DealDetailDialog + 7 telas navegam para /leads?lead=<id> |
| `inv:H1-06` | Testando | Testado | Action pills dentro do modal do Negócio | e6d5ac0b · PR #1315 — dealPills(); funil custom sem pill por trava de schema |
| `inv:H1-07` | Testando | Testar | assertMemberInOrg — recusa dono de outra organização ao abrir negócio | dbdf3411 · achado do /security-rubric no próprio diff |
| `inv:H1-08` | Testando | Testado | "Novo negócio" vira a única porta de criação na interface | PR #1315 — modal só oferece campo com casa no banco |

## H2 · Redesenho da aba de Funis

`inv:H2` · Testar: 7 · Testado: 5

| Chave | Coluna TOR | Régua | Subtask | Evidência / nota |
|---|---|---|---|---|
| `inv:H2-01` | Testando | Testar | FunnelControlBar — faixa única de controles (Modelo 1) na Qualificação | 2375d9f1 · PR #1315 — cinco fileiras viram uma |
| `inv:H2-02` | Testando | Testar | FunnelSwitcher + funnel-nav.ts — nome do funil vira a porta pros outros | 2375d9f1 — Estruturais / Customizados / Com prazo |
| `inv:H2-03` | Testando | Testar | Faixa enxugada aos seis controles; coluna vira superfície de 292px | e61f5514 — rodapé "+ Novo negócio" que de fato cria (o "+" não tinha handler) |
| `inv:H2-04` | Testando | Testado | Faixa única propagada aos quatro funis | 823dfb63 · PR #1316 |
| `inv:H2-05` | Testando | Testar | FunnelViewsMenu — alternador de visão dentro de Visualizações | 823dfb63 — zero teste referencia o componente |
| `inv:H2-06` | Testando | Testar | Filtro "Criados no período" vira seção do painel de Filtros | 823dfb63 — saiu do menu de três pontinhos |
| `inv:H2-07` | Testando | Testar | Faixa de tempo da reunião (Confirmação) vira seção do painel | 823dfb63 |
| `inv:H2-08` | Testando | Testado | Filtro "Parado há" no funil customizado | 823dfb63 — único funil onde já está ligado |
| `inv:H2-09` | Testando | Testado | Filtro "Parado há" nos três funis do sistema — construído e desligado | flag STALLED_FILTER_ENABLED_FOR_SYSTEM_PIPES=false até a migration ir a prod |
| `inv:H2-10` | Testando | Testado | Ordenação por coluna no Kanban com aviso de ordenação parcial | 823dfb63 — avisa quando a coluna tem mais gente que a página |
| `inv:H2-11` | Testando | Testado | metrics-period tolera data serializada | 823dfb63 |
| `inv:H2-12` | Testando | Testar | LeadCardCompact — card compacto do protótipo nos quatro funis | 067f5f0a · PR #1318 — 262,6px → 98,8px medido em 1440x900 |

## H3 · Fatia 2 — banco: o Negócio vira a unidade do funil

`inv:H3` · Testado: 17 · Testar: 3 · Fazendo: 1

| Chave | Coluna TOR | Régua | Subtask | Evidência / nota |
|---|---|---|---|---|
| `inv:H3-01` | Testando | Testado | M1 · 20270730000050 — derruba os TRÊS cadeados e destrava a recompra | provado em branch efêmera — ponto de não-retorno da feature |
| `inv:H3-02` | Testando | Testado | 20270730000010 — RLS de deals com escopo multi-org e ramo de master | reprovada em duas revisões antes de fechar |
| `inv:H3-03` | Testando | Testado | 20270730000020 — leads.claimed_by / claimed_at (base do "Assumir") | pré-requisito do M6: sem ela o gatilho do M6 falha |
| `inv:H3-04` | Testando | Testado | 20270730000030 — custom_pipe_entries.deal_id + propagação nos dois sentidos | 16.176 cards em 24 orgs que não tinham deal_id |
| `inv:H3-05` | Testando | Testar | 20270730000040 — auto-seed respeita a flag deal_manual_only por org | gate por organização; ingest em edge function ainda ignora (item A) |
| `inv:H3-06` | Testando | Testado | M6 · 20270731000010 — trava contra responsável de outra organização | 8 colunas, provada em 6 casos; escrita e NÃO acesa |
| `inv:H3-07` | Testando | Testado | 20270803000010 — deals para de carregar posição (DROP pipeline_id/stage_id) | índices e FK caem sozinhos, sem CASCADE |
| `inv:H3-08` | Testando | Testado | 20270803000020 — RPC abrir_negocio (a porta única de criação) | SECURITY INVOKER + título derivado "Negócio de mês/ano" |
| `inv:H3-09` | Testando | Testado | 20270803000030 — índice único parcial em pipeline_entries.deal_id | um negócio, uma posição; recusou dois cards no mesmo negócio em branch |
| `inv:H3-10` | Testando | Testado | 20270803000040 — espelho leads.pipe_whatsapp esvazia em vez de congelar | sem isso o {estagio} mentia e a condição casava sempre |
| `inv:H3-11` | Testando | Testado | 20270803000050 — RPC mover_negocio (avançar move, não copia) | recusa destino em funil custom de propósito (passo 5c em aberto) |
| `inv:H3-12` | Fazendo | Fazendo | 20270805000010 — aposenta os funis de Carteira | c1718248, só na branch feat/card-do-lead (PR #1411 aberta) |
| `inv:H3-13` | Testando | Testado | 20270729000010 — parâmetros de "parado há" nas RPCs do board | schema-only; dropa assinaturas antes de recriar e revoga PUBLIC+anon |
| `inv:H3-14` | Testando | Testado | Reescrever bulk_move_stage e bulk_add_to_custom_pipe sem ON CONFLICT no par | o par (pipeline_id, lead_id) deixou de ser único |
| `inv:H3-15` | Testando | Testado | Tolerar N negócios nos 26 call sites chaveados pelo par (funil, lead) | e3d20145 — Copilot e workflow incluídos |
| `inv:H3-16` | Testando | Testar | Rollback da 20270730000020 (leads_claim) | escrito, nunca exercitado |
| `inv:H3-17` | Testando | Testado | scripts/m6-inventario.sql — inventário do responsável cross-org | cresceu de 9 para 14 pares: campanha_leads (503×4) e campanha_members eram invisíveis |
| `inv:H3-18` | Testando | Testar | scripts/m6-limpeza-cross-org.sql — limpeza com backup e guarda | DML executável, NÃO executada em prod |
| `inv:H3-19` | Testando | Testado | scripts/backfill-lead-negocio-m4.{sql,mjs} — cada card vira um Negócio | um por card (decisão 11 revertida); título derivado do created_at no fuso da org |
| `inv:H3-20` | Testando | Testado | scripts/db-push-branch.sh — guarda mecânica de escrita | 5ff10b76 — recusa ref de prod, dev aposentado e checkout linkado; as 5 recusas exercitadas |
| `inv:H3-21` | Testando | Testado | scripts/seed-branch.mjs + assert-dev-not-prod + dev:branch | 5ff10b76 — predev recusa apontar o front para produção |

## H4 · Fatia 2 — backend, Copilot, workflows e ingest

`inv:H4` · Testado: 4 · Testar: 7

| Chave | Coluna TOR | Régua | Subtask | Evidência / nota |
|---|---|---|---|---|
| `inv:H4-01` | Testando | Testado | Copilot decide a ação lendo a etapa do Negócio e para de criar Negócio sozinho | 85ef467f — enqueuePipelineStageUpdate criava entry via upsert |
| `inv:H4-02` | Testando | Testado | Roteamento de agente e prompt do Copilot leem a posição do Negócio | 85ef467f — build-prompt, context-loader, agent-router, lead-profile-builder |
| `inv:H4-03` | Testando | Testar | Follow-ups do Copilot em lote filtram pelo Negócio | process-copilot-followups — sem teste próprio |
| `inv:H4-04` | Testando | Testar | Executor de workflow e action-handler leem a etapa do Negócio | b55a8881 — 5 leitores em 4 arquivos de _shared |
| `inv:H4-05` | Testando | Testado | Condição de automação com campo stage para de casar contra estado congelado | b55a8881 — era risco de envio ERRADO, não de envio faltando |
| `inv:H4-06` | Testando | Testar | Variável {estagio} das mensagens sai do Negócio, não do espelho legado | whatsapp-helpers.ts:324,340 |
| `inv:H4-07` | Testando | Testar | Leitura em lote achata N→1 com o mesmo critério dos demais leitores | — |
| `inv:H4-08` | Testando | Testar | Funil customizado: caminho do Copilot/workflow para de duplicar card | — |
| `inv:H4-09` | Testando | Testado | Apagar a rota /negocios do front (8 arquivos, 1.485 linhas) | 2d24c84c — 5 sítios de edição em 4 arquivos; dois quebravam o build |
| `inv:H4-10` | Testando | Testar | Religar o "compareceu" (Confirmação→Propostas) ao mover_negocio | 6f81a443 — deixa de criar gêmeo em Orçamentos |
| `inv:H4-11` | Testando | Testar | Religar as outras duas telas de transição ao mover_negocio | feeb60b4 — PipeWhatsapp e MeetingFieldBlock |

## H5 · L4 — a aba de Leads e os dois cards do Torque

`inv:H5` · Testar: 5 · Testado: 2 · Fazendo: 10 · A fazer: 6

| Chave | Coluna TOR | Régua | Subtask | Evidência / nota |
|---|---|---|---|---|
| `inv:H5-01` | Testando | Testar | Cluster "Dados" sai da lista e vai para o drawer (ADR-0024 §1) | 1769d010 · PR #1407 — 290px de volta; coluna vazia em 97,1% das linhas |
| `inv:H5-02` | Testando | Testar | Stat cards do topo contam a organização, não a página (ADR-0024 §2) | 3104b73c · PR #1410 — highRating/thisMonth/withSDR contavam só a página |
| `inv:H5-03` | Testando | Testado | Lista ordena por clique no cabeçalho | f9f4f1b2 · PR #1410 — ordem entra na queryKey do useLeads (área frágil) |
| `inv:H5-04` | Testando | Testado | Colunas Relação e Situação, lado a lado, nunca colapsadas (ADR-0023 §6) | 86784a39 · PR #1409 — 170 leads têm um ganho e um aberto ao mesmo tempo |
| `inv:H5-05` | Fazendo | Fazendo | Bloco "Compras" no drawer do lead | destino do cluster Dados |
| `inv:H5-06` | Testando | Testar | Precedência venda-vs-carteira extraída para módulo puro | — |
| `inv:H5-07` | Testando | Testar | Relação e Situação também no card do celular | Leads.tsx:766-802 — escrito, sem prova |
| `inv:H5-08` | Testando | Testar | Posição da etapa no useLeadsDeals para o desempate da Situação | — |
| `inv:H5-09` | Fazendo | Fazendo | Card do Lead — a ficha da pessoa | 88f87146 · PR #1411 ABERTA — cabeçalho Relação+Situação, anotação ancorada, Histórico/Negócios/Dados |
| `inv:H5-10` | Fazendo | Fazendo | Card do Negócio — a ficha da venda | 88f87146 · PR #1411 — tempo lidera (sale_value existe em 1,1%); alerta de estagnação por mediana da etapa |
| `inv:H5-11` | Fazendo | Fazendo | Montagem: Card do Lead na aba Leads, Card do Negócio no pipe-whatsapp | nunca empilham; clicar na pessoa troca de card |
| `inv:H5-12` | Fazendo | Fazendo | stageIndex e stageCount no useLeadsDeals para a barra de progresso | stagePosition sozinho não serve de denominador |
| `inv:H5-13` | Fazendo | Fazendo | Card do Negócio move, ganha e perde pela trilha do funil | 5f0753b3 — via useCrossPipeMove; botões somem sem etapa terminal (83 funis custom) |
| `inv:H5-14` | Fazendo | Fazendo | Edição inline dos campos do Lead volta ao card novo | 5f0753b3 — useUpdateLead + useSaveCustomFieldValue; chave de sistema É o nome da coluna |
| `inv:H5-15` | Fazendo | Fazendo | Interruptor do Copilot e Excluir voltam ao cabeçalho do card | 5f0753b3 |
| `inv:H5-16` | Fazendo | Fazendo | Campo sem coluna (CNPJ, site, nascimento, endereço) e enum marcados só-leitura | 5f0753b3 — visíveis com cadeado até a migration que cria as colunas |
| `inv:H5-17` | Fazendo | Fazendo | Rota /preview.html dos dois cards, sem App nem Supabase | 88f87146 |
| `inv:H5-18` | A fazer | A fazer | "Criar negócio" pelo Card do Lead (abrir o NewDealDialog) | construtor de opções vive dentro do CrossPipePanel (682 linhas, área frágil) |
| `inv:H5-19` | A fazer | A fazer | Card do Negócio novo montado nos outros três funis e na aba de Leads | hoje só no pipe-whatsapp |
| `inv:H5-20` | A fazer | A fazer | Resolver o destino do bloco "Compras" — o drawer da ADR-0024 §1 não é mais montado | os dois cards substituíram o drawer |
| `inv:H5-21` | A fazer | A fazer | useLeadsStats aplicar os mesmos filtros da lista | — |
| `inv:H5-22` | A fazer | A fazer | Ordenação da lista no celular | — |
| `inv:H5-23` | A fazer | A fazer | Avisar a piloto do salto nos números dos stat cards antes do deploy | ADR-0024: vão ler MAIS alto — é correção, mas parece regressão |

## H6 · Carteira vira recompra (ADR-0023 §8)

`inv:H6` · Fazendo: 2 · Testado: 2

| Chave | Coluna TOR | Régua | Subtask | Evidência / nota |
|---|---|---|---|---|
| `inv:H6-01` | Fazendo | Fazendo | Aposentar os funis de Carteira (upsell_base / upsell_gestao) | c1718248 — 1.078 etapas ativas em 97 orgs e ZERO entries usando; desativa, não apaga |
| `inv:H6-02` | Fazendo | Fazendo | Limpar as 4 transições que apontavam para a carteira antes de desativar | ponteiro para funil inativo faz o move falhar em silêncio |
| `inv:H6-03` | Testando | Testado | Converter os 344 pedidos de ERP em Negócios ganhos | scripts/backfill-carteira-negocios — 182 leads, 13 orgs; idempotente por deals.metadata |
| `inv:H6-04` | Testando | Testado | Recusar org sem etapa de ganho ativa no backfill da carteira | sem destino o backfill inventaria lugar — defeito dos 83 funis custom sem desfecho |

## H7 · Documentação, ADRs e ensaios de deploy

`inv:H7` · Concluído: 9 · Fazendo: 1

| Chave | Coluna TOR | Régua | Subtask | Evidência / nota |
|---|---|---|---|---|
| `inv:H7-01` | Concluído | Concluído | Spec da fatia 2 com as decisões A–F medidas em produção | d836bd61 — três decisões mudaram por causa da medição |
| `inv:H7-02` | Concluído | Concluído | ADR-0023 — o Negócio é a unidade do funil (supersede ADR-0005) | 8382dfe3 · docs/adr/0023 |
| `inv:H7-03` | Concluído | Concluído | ADR-0024 — o que a aba de Leads mostra (3 decisões) | b810610a · PR #1404 · docs/adr/0024 |
| `inv:H7-04` | Concluído | Concluído | Reverter a decisão 11 — backfill volta a um Negócio por card | e169f8b9 — 795 dos 801 pares envolvem Qualificação; fundir apagaria 933 cards |
| `inv:H7-05` | Concluído | Concluído | Corrigir o item 3 do L1: são cinco nós n8n, não dois | 83a51dad |
| `inv:H7-06` | Concluído | Concluído | Plano de migrations M1–M6 e decisões D1/D8 no vault | a5a9b0ad |
| `inv:H7-07` | Concluído | Concluído | Handoff do L4 para sessão limpa | f7af5483 |
| `inv:H7-08` | Concluído | Concluído | Receita ensaiada do apply das 22 migrations pendentes | 76a46132 — 22, não 41; a única falha é omie_foundation (42P07) |
| `inv:H7-09` | Concluído | Concluído | Ensaio cronometrado do backfill M4 e leitura dos 11 gatilhos | 2d299a2e — 1,7s na maior org, ~16s o backfill inteiro; nenhum gatilho dispara envio |
| `inv:H7-10` | Fazendo | Fazendo | Aviso operacional da virada para a Milennials (texto) | aviso-operacional-milennials.md — escrito, não enviado |

## H8 · Testes e provas

`inv:H8` · Testado: 29 · A fazer: 5 · Testar: 1

| Chave | Coluna TOR | Régua | Subtask | Evidência / nota |
|---|---|---|---|---|
| `inv:H8-01` | Testando | Testado | Execução conjunta das 18 suítes da feature — 217 testes verdes | — |
| `inv:H8-02` | Testando | Testado | Suíte de ordenação de coluna do funil + faixas "Parado há" client-side | tests/unit/funnel-column-sort.test.ts |
| `inv:H8-03` | Testando | Testado | Suíte dos dois filtros de tempo do funil | tests/unit/funnel-filters-period-stalled.test.ts |
| `inv:H8-04` | Testando | Testado | Suíte do contrato de ordem de deploy do "Parado há" (sharedRpcParams) | tests/unit/paginated-pipeline-stalled-params.test.ts |
| `inv:H8-05` | Testando | Testado | Suíte das métricas de venda do lead (computeSalesMetrics) | tests/unit/leads-sales-metrics.test.ts |
| `inv:H8-06` | Testando | Testado | Suíte do título do Negócio no useLeadsDeals (decisão 9) | tests/unit/use-leads-deals-title.test.ts |
| `inv:H8-07` | Testando | Testado | Suíte do avanço de etapa pelo Copilot lendo o Negócio | tests/unit/decide-action-pipeline-stage.test.ts |
| `inv:H8-08` | Testando | Testado | Suíte de upsertLeadIntoCustomPipe reescrita para o mundo pós-M1 | tests/unit/stage-transition-custom-pipe.test.ts |
| `inv:H8-09` | Testando | Testado | Suíte useCreatePipeProposta.dedup — era verde sobre produção duplicando | tests/unit/usePipePropostas.dedup.test.ts |
| `inv:H8-10` | Testando | Testado | Suíte do avaliador de condições de workflow (field=stage) | — |
| `inv:H8-11` | Testando | Testado | Suítes do Copilot atualizadas (agent-router, lead-profile-builder) | — |
| `inv:H8-12` | Testando | Testado | Suíte de resolveVariables do workflow-action-handler | — |
| `inv:H8-13` | Testando | Testado | Suíte de ordenação da lista de Leads pelo cabeçalho | — |
| `inv:H8-14` | Testando | Testado | Suíte de Relação e Situação do lead | — |
| `inv:H8-15` | Testando | Testado | Suíte do DealDetailDialog | — |
| `inv:H8-16` | Testando | Testado | Suíte do NewDealDialog | — |
| `inv:H8-17` | Testando | Testado | Suíte de invalidação de cache do useCrossPipeMove | — |
| `inv:H8-18` | Testando | Testado | Suíte do CrossPipePanel no modelo de Negócio | — |
| `inv:H8-19` | Testando | Testado | Prova da fatia 2 em branch efêmera — 8 asserções verdes | 9026075b · qa-seed/fatia2-branch-seed.sql |
| `inv:H8-20` | Testando | Testado | Prova do M4: lead com dois cards sai com DOIS negócios | f40e4dcc · qa-seed/fatia2-m4-dois-negocios.sql |
| `inv:H8-21` | Testando | Testado | Fixture de guardas do M4 e os três contrafactuais | qa-seed/m4-fixture.sql |
| `inv:H8-22` | Testando | Testado | Teste de comportamento do M6 (trava cross-org) | qa-seed/m6-teste.sql |
| `inv:H8-23` | Testando | Testado | Prova do espelho pipe_whatsapp que parou de congelar (5 casos) | qa-seed/fatia2-move-espelho.sql |
| `inv:H8-24` | Testando | Testado | A/B de métricas de reunião: mover produz o mesmo que duplicar | qa-seed/fatia2-move-metricas.sql |
| `inv:H8-25` | Testando | Testado | Prova do M1: bulk move preserva o negócio ganho | — |
| `inv:H8-26` | Testando | Testado | Prova da Carteira: 3 pedidos de ERP → 3 Negócios ganhos no mesmo funil | qa-seed/carteira-recompra-seed.sql |
| `inv:H8-27` | Testando | Testado | Ensaio do apply das 22 migrations de ponta a ponta | branch yyvzakfeddnulpgdkgbm, encerrada |
| `inv:H8-28` | Testando | Testado | Ensaio cronometrado do M4 em volume real (4.221 cards) | qa-seed/volume-m4-seed.sql |
| `inv:H8-29` | Testando | Testado | Seed de usuário logado em branch para ver a aba de Leads | qa-seed/card-do-lead-auth-user.sql + promove-admin.sql |
| `inv:H8-30` | A fazer | A fazer | LACUNA: QA logado com admin, membro e master separadamente | a correção de RLS de deals é exatamente sobre master e multi-org |
| `inv:H8-31` | A fazer | A fazer | LACUNA: os dois cards novos não têm nenhum teste automatizado | zero arquivo de teste importa lead-card/deal-card |
| `inv:H8-32` | A fazer | A fazer | LACUNA: unidades novas do redesenho de Funis e do move sem cobertura | — |
| `inv:H8-33` | A fazer | A fazer | LACUNA: teste em celular (abaixo de 768px) | a entrega da fatia 1 não existe abaixo de 768px |
| `inv:H8-34` | Testando | Testar | LACUNA: prova de ponta do "Parado há" nos 3 funis do sistema | segue desligado por flag |
| `inv:H8-35` | A fazer | A fazer | LACUNA: o sinal de CI não vale como gate — main e develop vermelhas | ~157 testes de dívida herdada; gate real é ratchet local |

## H9 · Deploy em produção — nada aplicado ainda

`inv:H9` · Fazendo: 1 · A fazer: 23

| Chave | Coluna TOR | Régua | Subtask | Evidência / nota |
|---|---|---|---|---|
| `inv:H9-01` | Fazendo | Fazendo | Mergear a PR #1411 (dois cards + Carteira recompra) em develop | aberta; 190 arquivos, +36.119 linhas |
| `inv:H9-02` | A fazer | A fazer | Fechar ou rebasar a PR #1405 (feat/aba-leads-l4) — duplicada e conflitante | CONFLICTING; conteúdo já entrou por #1407/#1409/#1410 |
| `inv:H9-03` | A fazer | A fazer | Reconferir o ledger de produção contra a receita antes do apply | prod = 57 versões, última 20270807000003; outra frente aplica direto em prod |
| `inv:H9-04` | A fazer | A fazer | Aplicar as 22 migrations pendentes em produção | db push → repair 20270203000000 → db push; botão do humano |
| `inv:H9-05` | A fazer | A fazer | Reparar 20270203000000 (omie_foundation) como aplicada durante o push | falha previsível 42P07 — omie_connections já existe |
| `inv:H9-06` | A fazer | A fazer | Rodar a verificação pós-apply e conferir travas = 0 | se travas ≠ 0 a fatia 2 não valeu e o backfill não deve rodar |
| `inv:H9-07` | A fazer | A fazer | Rodar a limpeza dos responsáveis cross-org (14 pares, com backup) | ANTES de acender o M6, senão 1.091 cards ficam imóveis |
| `inv:H9-08` | A fazer | A fazer | Acender o M6 na ordem certa (depende de leads.claimed_by existir) | aplicar o M6 avulso falha |
| `inv:H9-09` | A fazer | A fazer | Rodar o backfill M4 em produção, org a org (Milennials primeiro) | 38.898 cards, 67 orgs, ~16s de execução |
| `inv:H9-10` | A fazer | A fazer | Reconciliar o card dd91cd35 da Basic4u antes do backfill dessa org | única org bloqueada; a guarda 0b para antes de escrever |
| `inv:H9-11` | A fazer | A fazer | Rodar o backfill da Carteira (344 pedidos de ERP) org a org | — |
| `inv:H9-12` | A fazer | A fazer | Deployar as 29 edge functions tocadas pela fatia 2 | medido: zero delas está deployada com este código |
| `inv:H9-13` | A fazer | A fazer | Abrir e mergear o PR develop→main da fatia 2 | merge em main constrói a imagem |
| `inv:H9-14` | A fazer | A fazer | Publicar o front em produção (Redeploy EasyPanel) e resolver a contradição do doc de deploy | CLAUDE.md da raiz e origin/main discordam sobre deploy automático |
| `inv:H9-15` | A fazer | A fazer | Regenerar types.ts a partir de produção depois do apply | gerar da branch corrompe — a branch não tem as órfãs de prod |
| `inv:H9-16` | A fazer | A fazer | Remover as pontes as never de abrir_negocio e mover_negocio | só depois do apply + types |
| `inv:H9-17` | A fazer | A fazer | Acender a flag deal_manual_only na Milennials (piloto) | — |
| `inv:H9-18` | A fazer | A fazer | Fechar o item A: ingest em edge function ignora a flag deal_manual_only | o gate está no banco, não no código das funções |
| `inv:H9-19` | A fazer | A fazer | Patchar os 4 nós n8n de ingest para pararem de mandar place_in_pipe | no MESMO dia do aviso operacional, senão vira chamado de "sumiu lead" |
| `inv:H9-20` | A fazer | A fazer | Decidir o destino do 5º nó n8n (Sweep Reunião → Agendado) | faz PATCH direto em pipeline_entries a cada 3 min, fora de qualquer guarda |
| `inv:H9-21` | A fazer | A fazer | Enviar o aviso operacional à Milennials no dia da virada | — |
| `inv:H9-22` | A fazer | A fazer | 🔴 Rotacionar a service_role key de produção exposta em texto plano no n8n | nó bUHokUwk8Brv4xNo — ignora RLS no banco inteiro, não só na piloto |
| `inv:H9-23` | A fazer | A fazer | 🔴 Rotacionar o x-webhook-key do lead-webhook (segredo adivinhável) | quem adivinhar injeta lead na organização |
| `inv:H9-24` | A fazer | A fazer | Limpar os sítios que ainda ESCREVEM leads.pipe_whatsapp antes do DROP | inventário subestimado: 10 sítios, não 8 |

## H10 · Decisões abertas e fatia 3

`inv:H10` · A fazer: 24 · Fazendo: 2

| Chave | Coluna TOR | Régua | Subtask | Evidência / nota |
|---|---|---|---|---|
| `inv:H10-01` | A fazer | A fazer | Decidir o passo 5c — mover Negócio para funil customizado | obriga delete+insert e o card perde o id; mover_negocio recusa de propósito |
| `inv:H10-02` | A fazer | A fazer | Decidir o escopo restante da fusão de identidade com a Carteira (§8) | a outra metade da aba de Leads |
| `inv:H10-03` | A fazer | A fazer | Decidir se a rota /carteira prometida pelo ADR-0005 é terminada ou enterrada | meio construída há meses |
| `inv:H10-04` | A fazer | A fazer | Escrever o plano de rollback para depois do primeiro Negócio do piloto | reversível só enquanto ninguém criar negócio novo |
| `inv:H10-05` | A fazer | A fazer | Fechar por escrito a fronteira com o dev do redesenho de funis | os dois trabalhos tocam as mesmas 4 páginas |
| `inv:H10-06` | Fazendo | Fazendo | Auditar os 6 fluxos n8n restantes da piloto | 5 dos 8 já abertos e mapeados em 83a51dad |
| `inv:H10-07` | A fazer | A fazer | D1 — "mover a coluna inteira": construir, e com qual trava? | já custou 3 bans de número de WhatsApp |
| `inv:H10-08` | A fazer | A fazer | D2 — o botão de Disparo continua no cabeçalho do funil? | — |
| `inv:H10-09` | A fazer | A fazer | D3 — a soma por coluna volta ao Kanban? | hoje só em Propostas e errada acima de 20 registros |
| `inv:H10-10` | A fazer | A fazer | D4 — funil customizado passa a carregar por página? | hoje esconde o que passa de mil, calado |
| `inv:H10-11` | A fazer | A fazer | D5 — quais são os cinco números do Analytics novo | "valor em aberto" precisa de definição de negócio |
| `inv:H10-12` | A fazer | A fazer | D6 — celular e desktop passam a ter a mesma lista? | — |
| `inv:H10-13` | A fazer | A fazer | D7 — quando abre a janela de produção para o "Parado há" | construído e testado, esperando a janela |
| `inv:H10-14` | A fazer | A fazer | D8 — nivelar capacidade entre funis (documento antes de código) | receita fora de Propostas não aparece em relatório nenhum |
| `inv:H10-15` | A fazer | A fazer | F2 — Lista completa nos quatro funis | depende de D3 |
| `inv:H10-16` | A fazer | A fazer | F3 — Analytics do que está parado agora | depende de D5 |
| `inv:H10-17` | A fazer | A fazer | F4 — paridade do funil customizado (alternador, Lista, Analytics) | depende de D4 |
| `inv:H10-18` | A fazer | A fazer | F5 — convergir a lista de celular e a de desktop | depende de D6 |
| `inv:H10-19` | A fazer | A fazer | Fatia 3 — desenhar e construir o "Assumir" no lead | coluna já existe na migration; a interação não |
| `inv:H10-20` | A fazer | A fazer | Fatia 3 — a entrega da fatia 1/2 no celular (abaixo de 768px) | — |
| `inv:H10-21` | A fazer | A fazer | Fatia 3 — DROP COLUMN leads.pipe_whatsapp | depois de limpar os 10 sítios de escrita |
| `inv:H10-22` | A fazer | A fazer | Fatia 3 — decidir se "venda ganha → cliente de carteira" precisa existir | hoje NÃO existe: handle_proposta_vendida tem zero gatilhos |
| `inv:H10-23` | A fazer | A fazer | Fatia 3 — caminho contínuo de venda de ERP → Negócio (hoje só backfill) | — |
| `inv:H10-24` | Fazendo | Fazendo | Fatia 3 — a funcionalidade da Carteira migrando para a aba de Leads | a identidade já migrou; a funcionalidade não |
| `inv:H10-25` | A fazer | A fazer | Simplificar a regra de "Cliente" para uma prova só | 220 leads por negócio ganho e 739 por ERP, só 52 em ambos |
| `inv:H10-26` | A fazer | A fazer | Fila dos ~150 clientes atrasados na recompra | o que a Carteira-como-recompra permite perguntar |
