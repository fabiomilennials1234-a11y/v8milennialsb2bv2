# Second Brain Obsidian v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the Obsidian vault into a complete second brain with deep feature documentation, automatic change tracking, and backlog management.

**Architecture:** 35+ feature notes organized by business domain, a post-commit hook for automatic tracking, a `/second-brain` custom skill for manual updates, and CLAUDE.md integration so every session starts by consulting the vault.

**Tech Stack:** Obsidian Markdown, Claude Code hooks (settings.json), shell scripting, Claude Code custom skills.

**Vault root:** `/Volumes/Untitled/v8milennialsb2bv2-main/Obsidian/Segundo Cerebro/Claude Code — Torque CRM/`

---

## Task 1: Create Feature Notes — Comunicacao (3 notes)

**Files:**
- Create: `06 — Features/Comunicacao/Chat WhatsApp.md`
- Create: `06 — Features/Comunicacao/Mensagens Agendadas.md`
- Create: `06 — Features/Comunicacao/Templates de Mensagem.md`

- [ ] **Step 1: Create folder structure**

```bash
mkdir -p "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/Comunicacao"
```

- [ ] **Step 2: Write Chat WhatsApp.md**

Feature data:
- **O que faz**: Interface unificada de chat multi-canal (WhatsApp via Evolution API, Messenger, Instagram via Meta, SZ.Chat). Usuarios recebem e enviam mensagens em todos os canais numa unica tela com lista de contatos, historico e envio de texto/midia.
- **Regras de negocio**: Mensagens agrupadas por contact_key (phone para WhatsApp, sender_id para Meta). Unread tracking via localStorage. Copilot pode responder automaticamente com batch de 8s. Human takeover pausa o bot por 10 min.
- **Como o usuario usa**: Abre Chat WhatsApp → ve lista de contatos com badge de canal → clica no contato → ve historico → digita/envia mensagem ou midia.
- **Edge cases**: Lead sem telefone nao aparece no chat. Mensagens de canais diferentes do mesmo lead aparecem separadas por contact_key.
- **Componentes**: `src/components/chat/WhatsAppChat.tsx` (UI principal), `ChannelBadge.tsx` (badge de canal), `LeadDetailContent.tsx` (detalhe do lead no chat)
- **Hooks**: `useChannelChat.ts` — `useChannelContacts()` (queryKey: ["channel-contacts", orgId]), `useChannelMessages(contactKey)`, `useSendChannelMessage()`, `useChannelMessagesRealtime()`
- **Edge Functions**: `evolution-api-proxy` (proxy WhatsApp), `evolution-webhook` (recebe msgs WhatsApp), `sz-chat-webhook`/`sz-chat-send` (SZ.Chat), `send-meta-message` (Messenger/Instagram)
- **Tabelas**: `channel_messages` (storage unificado), `whatsapp_instances`, `sz_chat_config`, `meta_pages`
- **Fluxo**: Webhook externo → edge function → insere em `channel_messages` → realtime subscription → React Query invalidate → UI atualiza

- [ ] **Step 3: Write Mensagens Agendadas.md**

Feature data:
- **O que faz**: Agendar mensagens WhatsApp para envio em data/hora especifica. Suporta texto, imagens, video, audio e documentos. Background job processa a cada minuto.
- **Regras de negocio**: Status: scheduled → sending → sent/failed. Retry ate 3x. Media uploaded pro Supabase Storage antes do agendamento. Cron roda a cada 1 min.
- **Como o usuario usa**: No chat, clica no icone de agendar → escolhe data/hora → escreve mensagem ou anexa midia → confirma. Pode editar ou cancelar antes do envio.
- **Edge cases**: Se WhatsApp instance cair, mensagem fica como failed. Se lead nao tem telefone, nao permite agendar.
- **Componentes**: `src/components/chat/ScheduleMessageModal.tsx`, `ScheduledMessagesBanner.tsx`
- **Hooks**: `useScheduledMessages.ts` — `useScheduledMessagesForLead(leadId)`, `useCreateScheduledMessage()`, `useCancelScheduledMessage()`, `useUpdateScheduledMessage()`, `useMyScheduledMessages()`
- **Edge Functions**: `process-scheduled-user-messages` (cron 1 min, envia via evolution-api-proxy ou sz-chat-send)
- **Tabelas**: `scheduled_user_messages` (id, lead_id, phone_number, message_content, media_url, media_type, scheduled_at, status, sent_at, error_message, retry_count)
- **Fluxo**: Usuario agenda → insere row (status=scheduled) → pg_cron 1min → edge function busca pendentes → envia via API → atualiza status

- [ ] **Step 4: Write Templates de Mensagem.md**

Feature data:
- **O que faz**: Templates reutilizaveis com variaveis dinamicas ({nome}, {empresa}, {email}, {atendente}) e slash commands (/saudacao, /follow-up). Preview ao vivo com dados de exemplo.
- **Regras de negocio**: Command unico por org, formato `^[a-z0-9][a-z0-9-]*$`. Variaveis resolvidas em runtime com dados do lead. Campos custom via pattern `{campo:slug}`.
- **Como o usuario usa**: Menu Configuracoes → Templates → Criar template → Define comando, nome, corpo com variaveis → Salva. No chat, digita /comando para inserir.
- **Edge cases**: Variavel sem valor no lead resolve para string vazia. Commands duplicados dao erro de unique constraint.
- **Componentes**: `src/pages/MessageTemplates.tsx` (CRUD completo com grid, busca, modais)
- **Hooks**: `useMessageTemplates.ts` — `useMessageTemplates()`, `useCreateMessageTemplate()`, `useUpdateMessageTemplate()`, `useDeleteMessageTemplate()`
- **Lib**: `src/lib/template-variables.ts` — `TEMPLATE_VARIABLES[]`, `resolveVariables(body, lead, attendant)`, `PREVIEW_LEAD`, `PREVIEW_ATTENDANT`
- **Tabelas**: `message_templates` (id, organization_id, command, display_name, body, created_by)
- **Fluxo**: Admin cria template → salva no banco → usuario digita /comando no chat → frontend resolve variaveis com dados do lead → insere texto no campo de mensagem

- [ ] **Step 5: Verify notes in Obsidian**

```bash
obsidian vault="Segundo Cerebro" files folder="Claude Code — Torque CRM/06 — Features/Comunicacao"
```

Expected: 3 files listed.

---

## Task 2: Create Feature Notes — Vendas (8 notes)

**Files:**
- Create: `06 — Features/Vendas/Pipe WhatsApp.md`
- Create: `06 — Features/Vendas/Pipe Confirmacao.md`
- Create: `06 — Features/Vendas/Pipe Propostas.md`
- Create: `06 — Features/Vendas/Pipelines Customizados.md`
- Create: `06 — Features/Vendas/Funis Hub.md`
- Create: `06 — Features/Vendas/Follow-ups.md`
- Create: `06 — Features/Vendas/Produtos.md`
- Create: `06 — Features/Vendas/Upsell.md`

- [ ] **Step 1: Create folder**

```bash
mkdir -p "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/Vendas"
```

- [ ] **Step 2: Write Pipe WhatsApp.md**

Data:
- O que faz: Kanban de qualificacao de leads WhatsApp. Stages: novo → abordado → respondeu → esfriou → agendado. Drag-drop com realtime.
- Componentes: `src/pages/PipeWhatsapp.tsx`, `src/components/kanban/DraggableKanbanBoard.tsx`, `KanbanCard.tsx`, `src/components/leads/LeadCard.tsx`, `LeadDetailDrawer.tsx`
- Hooks: `usePipeWhatsapp.ts`, `usePipeMetrics.ts`, `usePipelineStages.ts`, `useStageWorkflows.ts`
- Edge Functions: `process-pipe-distribution`, `pipe-rule-dispatch`, `webhook-new-lead`
- Tabelas: `pipe_whatsapp` (lead_id, status, stage_id), `leads`, `team_members`, `lead_tags`, `lead_actions`

- [ ] **Step 3: Write Pipe Confirmacao.md**

Data:
- O que faz: Kanban de confirmacao de reuniao. Stages baseadas em dias ate a reuniao (D-5, D-3, D-2, D-1). Auto-move baseado em meeting_date vs data atual.
- Componentes: `src/pages/PipeConfirmacao.tsx`, `AddMeetingModal.tsx`, `RescheduleModal.tsx`, `CompareceuModal.tsx`, `MeetingTimeline.tsx`, `ConfirmacaoStats.tsx`, `ConfirmacaoFilters.tsx`
- Hooks: `usePipeConfirmacao.ts`, `useOrganizationSettings.ts` (overdue_days config)
- Edge Functions: `webhook-confirmacao`, `process-followup-automations`, `google-calendar-events`
- Tabelas: `pipe_confirmacao` (status: reuniao_marcada → confirmar_d5 → d3 → d2 → d1 → confirmacao_no_dia → remarcar → compareceu → perdido), `meeting_confirmations`
- Regra especial: Status computado por calendar days (nao 24h). Integra com Google Calendar.

- [ ] **Step 4: Write Pipe Propostas.md**

Data:
- O que faz: Kanban de propostas comerciais com produtos, calor (deal temperature), e commitment dates. Stages: marcar_compromisso → compromisso_marcado → proposta_enviada → esfriou → futuro → vendido → perdido.
- Componentes: `src/pages/PipePropostas.tsx`, `CreateProposalModal.tsx`, `CalorSlider.tsx`, `CommitmentDateModal.tsx`, `TinyErpConfirmOrderDialog.tsx`, `CalorAnalyticsChart.tsx`, `ProductAnalyticsChart.tsx`
- Hooks: `usePipePropostas.ts`, `usePipePropostasMetrics.ts`, `usePipePropostaItems.ts`, `useTinyErp.ts`
- Edge Functions: `tinyerp-push-order` (sync vendido → ERP), `pipe-rule-dispatch`, `process-ai-actions`
- Tabelas: `pipe_propostas`, `pipe_proposta_items` (product_id, sale_value), `products`
- Regra especial: Vendido → auto-sync para TinyERP. Metricas por periodo (mensal, trimestral).

- [ ] **Step 5: Write Pipelines Customizados.md**

Data:
- O que faz: Funis customizados por org com kanban, stages, e auto-routing pra outros pipes. Suporta permanent (sempre ativo) e temporary (time-boxed com metas).
- Componentes: `src/pages/CustomPipeline.tsx`, `CustomPipelineKanban.tsx`, `AddLeadToPipeModal.tsx`, `CustomPipeSettingsDialog.tsx`, `CreatePipelineModal.tsx`
- Hooks: `useCustomPipelines.ts`, `useCustomPipelineStages.ts`, `useCustomPipeEntries.ts`, `useCustomPipelineMembers.ts`
- Tabelas: `custom_pipelines` (lifecycle_type: permanent/temporary, status: draft/active/paused/ended, team_goal, individual_goal), `custom_pipeline_stages` (is_final_positive/negative, target_pipeline routing), `custom_pipe_entries`

- [ ] **Step 6: Write Funis Hub.md**

Data:
- O que faz: Dashboard central mostrando todos os pipes (WhatsApp, Confirmacao, Propostas, Upsell) e custom funnels. Entry point unico pra navegacao.
- Componentes: `src/pages/FunisHub.tsx`, `CreateFunilOuCampanhaModal.tsx`, `CreateTemporaryFunnelModal.tsx`
- Hooks: `usePipelineDisplayConfig.ts`, `usePermanentCustomFunnels.ts`, `useTemporaryFunnels.ts`
- Tabelas: `pipeline_display_config` (is_visible toggle por pipe), `custom_pipelines`

- [ ] **Step 7: Write Follow-ups.md**

Data:
- O que faz: Tarefas de follow-up auto-geradas por mudanca de stage ou criadas manualmente. Filtro por data (hoje/atrasado/futuro), prioridade, e responsavel. Integra com Copilot para auto-assign.
- Componentes: `src/pages/PipeFollowUps.tsx`, `FollowUpCard.tsx`, `ScheduleFollowUpModal.tsx`, `AutomationSettings.tsx`, `AcoesDoDia.tsx`
- Hooks: `useFollowUps.ts`, `useCompleteFollowUp.ts`, `useArchiveFollowUp.ts`, `useAgentFollowupRules.ts`, `useAutoFollowUp.ts`
- Edge Functions: `process-followup-automations` (5 min), `process-copilot-followups` (5 min)
- Tabelas: `follow_ups` (priority: low/normal/high/urgent, source_pipe, is_automated), `follow_up_automations` (trigger_type: stage_change/no_response/not_confirmed, days_offset, trigger_delay_hours), `acoes_do_dia`

- [ ] **Step 8: Write Produtos.md**

Data:
- O que faz: Catalogo de produtos B2B com 3 tipos (MRR, projeto, unitario). Variantes (cor, tamanho, SKU) com pricing independente. Import XLSX e sync TinyERP.
- Componentes: `src/pages/Produtos.tsx`, `CreateProductModal.tsx`, `EditProductModal.tsx`, `ProductImportModal.tsx`, `ProductMaterialsSection.tsx`
- Hooks: `useProducts.ts`, `useProductsWithVariants.ts`, `useProductVariants.ts`, `useProductMaterials.ts`, `useProductRanking.ts`
- Edge Functions: `tinyerp-sync-products`
- Tabelas: `products` (type: mrr/projeto/unitario, sku, ticket, ticket_minimo, logo_url, contrato_padrao_url), `product_variants`, `product_materials`

- [ ] **Step 9: Write Upsell.md**

Data:
- O que faz: Modulo de pos-venda e upsell com 2 kanbans — "Tempo de Venda" (ciclo) e "Gestao" (potencial/crescimento). Auto-move baseado em historico de pedidos e regras configuraveis.
- Componentes: `src/pages/Upsell.tsx`, `UpsellBaseKanban.tsx`, `UpsellGestaoKanban.tsx`, `CreateClientModal.tsx`, `NovaVendaModal.tsx`, `UpsellStats.tsx`, `ClientDetailModal.tsx`
- Hooks: `useUpsellClients.ts`, `useUpsellClientProducts.ts`, `useUpsellOrders.ts`, `useUpsellMetrics.ts`, `useUpsellGestaoRules.ts`, `useAutoMoveUpsellClients.ts`, `useUpsellCampanhas.ts`
- Edge Functions: `tinyerp-push-upsell-order`, `process-pipe-distribution`
- Tabelas: `upsell_clients` (potential/growth: low/med/high, base_status: prospectar/entrar/explorar/crescer/manter/reativar), `upsell_orders`, `upsell_campanhas`, `upsell_stage_rules`

- [ ] **Step 10: Verify**

```bash
obsidian vault="Segundo Cerebro" files folder="Claude Code — Torque CRM/06 — Features/Vendas"
```

Expected: 8 files.

---

## Task 3: Create Feature Notes — Automacao (3 notes)

**Files:**
- Create: `06 — Features/Automacao/Workflow Builder.md`
- Create: `06 — Features/Automacao/Campanhas.md`
- Create: `06 — Features/Automacao/Regras de Pipe.md`

- [ ] **Step 1: Create folder**

```bash
mkdir -p "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/Automacao"
```

- [ ] **Step 2: Write Workflow Builder.md**

Data:
- O que faz: Editor visual de automacoes (DAG) com React Flow. Nodes: trigger, action (send_whatsapp, move_stage, add_tag, assign_responsible), condition, delay, wait_response, split_ab, copilot, webhook_call, wait_business_window. 29+ trigger types, 25+ action types.
- Componentes: `src/pages/Automacoes.tsx` (lista), `AutomacoesEditor.tsx` (editor visual), `AutomacoesExecucoes.tsx` (historico), `src/components/automacoes/WorkflowCanvas.tsx`, `WorkflowSidebar.tsx`, `WorkflowToolbar.tsx`, `src/components/automacoes/nodes/`, `src/components/automacoes/edges/`, `src/components/automacoes/sidebar-panels/`
- Hooks: `useWorkflows()`, `useWorkflow(id)`, `useCreateWorkflow()`, `useDeleteWorkflow()`, `useToggleWorkflow()`, `useWorkflowPortability()`
- Edge Functions: `process-workflow-executions` (cron 1 min, batch 20)
- Tabelas: `workflows` (trigger_type, trigger_config JSONB, definition JSONB, loop_limit, is_active), `workflow_executions` (status, current_node_id, loop_counters, context), `workflow_execution_steps` (node_id, node_type, status, input_data, output_data)
- Types: `src/types/workflow.ts`
- Shared: `_shared/workflow-executor.ts`, `workflow-action-handler.ts`, `workflow-condition-evaluator.ts`, `workflow-trigger.ts`

- [ ] **Step 3: Write Campanhas.md**

Data:
- O que faz: Campanhas temporarias com metas individuais/time, bonus, e deadline. Modes: automatico, semi-automatico, manual. Kanban com stages customizaveis. Distribuicao round-robin ou random.
- Componentes: `src/pages/Campanhas.tsx`, `CampanhaDetail.tsx`, `CampanhaCard.tsx`, `CreateCampanhaModal.tsx`, `CampanhaKanban.tsx`, `CampanhaAnalytics.tsx`, `CampanhaDispatchRulesSection.tsx`, `AddLeadToCampanhaModal.tsx`, `ImportLeadsModal.tsx`, `ManageStagesModal.tsx`
- Hooks: `useCampanhas()`, `useCampanha(id)`, `useCreateCampanha()`, `useUpdateCampanha()`, `useDeleteCampanha()`, `useCampanhaMembers()`, `useCampanhaLeads()`
- Edge Functions: `campaign-rule-dispatch` (cron 1 min)
- Tabelas: `campanhas` (objective: qualificacao/agendamentos/propostas/livre, status: draft/active/paused/ended), `campanha_stages`, `campanha_members` (meetings_count, bonus_earned), `campanha_leads`, `campanha_dispatch_rules`, `campanha_dispatch_rule_steps`

- [ ] **Step 4: Write Regras de Pipe.md**

Data:
- O que faz: Dispatch automatico de mensagens quando lead entra ou muda de stage nos pipes (WhatsApp/Confirmacao/Propostas). Sequences com delay, wait_response, timeout, e reassignment.
- Edge Functions: `pipe-rule-dispatch` (cron 1 min)
- Tabelas: `pipe_dispatch_rules` (pipe_type, trigger_type: lead_added/lead_moved_to_stage, pipeline_stage_id, is_active), `pipe_dispatch_rule_steps` (action_type: send_template/wait_response/change_stage/assign_sdr/cancel_sequence, delay_minutes, wait_timeout_minutes), `scheduled_pipe_messages` (status: scheduled/sent/failed/waiting_response/timed_out/executed)

- [ ] **Step 5: Verify**

```bash
obsidian vault="Segundo Cerebro" files folder="Claude Code — Torque CRM/06 — Features/Automacao"
```

Expected: 3 files.

---

## Task 4: Create Feature Notes — IA (3 notes)

**Files:**
- Create: `06 — Features/IA/Copilot.md`
- Create: `06 — Features/IA/Oraculo Comercial.md`
- Create: `06 — Features/IA/Lead Score.md`

- [ ] **Step 1: Create folder**

```bash
mkdir -p "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/IA"
```

- [ ] **Step 2: Write Copilot.md**

Data:
- O que faz: Agentes IA conversacionais que interagem com leads via WhatsApp. Templates: qualificador, sdr, followup, agendador, prospectador, custom. Cada agente tem personalidade (tom, estilo, energia), capabilities (qualificar, agendar, mover cards), regras de kanban por stage, follow-up rules, FAQs embedadas via pgvector, e TTS via ElevenLabs.
- Regras de negocio: Um agente default por org. Copilot respeita human takeover (10 min pause). Batch de 8s para agrupar msgs antes de responder. SmartSplitMessage para chunking natural. Max FAQs por plano.
- Componentes: `src/pages/Copilot.tsx`, `CopilotMetrics.tsx`, `src/components/copilot/CopilotWizard.tsx` (wizard multi-step com 20+ steps), `AgentConfigModal.tsx`, `AgentFollowupRulesTab.tsx`, `AgentKanbanRulesTab.tsx`, `AgentMetricsTab.tsx`, `AgentTtsSettings.tsx`, `src/components/copilot/playground/`
- Hooks: `useCopilotAgents()`, `useCopilotAgent(id)`, `useCreateCopilotAgent()`, `useUpdateCopilotAgent()`, `useDeleteCopilotAgent()`, `useToggleCopilotAgent()`, `useSetDefaultCopilotAgent()`, `useCopilotAgentFaqs()`, `useCopilotKanbanRules()`, `useAgentFollowupRules()`, `useCopilotSubscription()`, `useCopilotPromptBuilder()`, `useCopilotAgentAudios()`
- Edge Functions: `agent-message` (processamento via OpenRouter LLM), `summarize-conversation`, `evaluate-agent-conversation`, `generate-agent-examples`, `generate-business-context`, `generate-custom-instructions`, `generate-faq-embeddings`, `generate-faqs`, `test-copilot-chat`, `elevenlabs-proxy`, `outbound-trigger`
- Tabelas: `copilot_agents` (template_type, personality_*, skills[], system_prompt, is_active, is_default), `copilot_agent_faqs` (question, answer, embedding), `copilot_agent_kanban_rules` (pipe_type, stage_name, goal, behavior, allowed_actions[]), `copilot_agent_followup_rules`, `copilot_agent_audios`, `conversations`, `conversation_messages`
- Types: `src/types/copilot.ts`
- AREA FRAGIL — testar fluxo completo sempre.

- [ ] **Step 3: Write Oraculo Comercial.md**

Data:
- O que faz: Coaching IA e forecasting de vendas. Analisa conversation summaries e metricas do time (reunioes confirmadas para SDRs, receita/vendas para closers). Gera recomendacoes personalizadas, estrategias de objecao, e previsoes de performance.
- Componentes: Integrado no Dashboard (tab Inteligencia), chat interativo
- Edge Functions: `oraculo-comercial` (analise via OpenRouter LLM)
- Tabelas: `conversation_summaries` (summary, key_points, sentiment, lead_temperature, objections, next_action, coaching_tips), `oraculo_usage` (rate limiting)

- [ ] **Step 4: Write Lead Score.md**

Data:
- O que faz: Score automatico 0-100 via IA. Analisa atributos do lead (nome, empresa, origem, segmento, faturamento, urgencia, rating, idade, telefone/email), progressao em pipes, e historico de interacoes. Pode rodar individual ou batch (leads sem score recente >24h).
- Hooks: `useLeadScore(leadId)`, `useLeadScores()`, `useCalculateLeadScore()`, `useCalculateBatchScores()`, `useLeadScoresMap()`
- Edge Functions: `calculate-lead-score` (OpenRouter LLM)
- Tabelas: `lead_scores` (score: 0-100, factors: JSONB, predicted_conversion: 0-100, recommended_action, last_calculated)

- [ ] **Step 5: Verify**

```bash
obsidian vault="Segundo Cerebro" files folder="Claude Code — Torque CRM/06 — Features/IA"
```

Expected: 3 files.

---

## Task 5: Create Feature Notes — Analytics (7 notes)

**Files:**
- Create: `06 — Features/Analytics/Dashboard.md`
- Create: `06 — Features/Analytics/Dashboard Outbound.md`
- Create: `06 — Features/Analytics/Analytics Comercial.md`
- Create: `06 — Features/Analytics/Analytics UTMs.md`
- Create: `06 — Features/Analytics/Performance.md`
- Create: `06 — Features/Analytics/Ranking.md`
- Create: `06 — Features/Analytics/TV Dashboard.md`

- [ ] **Step 1: Create folder**

```bash
mkdir -p "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/Analytics"
```

- [ ] **Step 2: Write Dashboard.md**

Data:
- O que faz: Dashboard principal com 4 tabs (Visao Geral, Performance, Inteligencia, Analytics). KPIs: total leads, reunioes, receita, conversao, no-show. Filtro por mes/ano e membro. Admin ve org inteira, membro ve so seus dados.
- Componentes: `src/pages/Dashboard.tsx`, `TabVisaoGeral.tsx`, `TabPerformance.tsx`, `TabInteligencia.tsx`, `TabAnalyticsV2.tsx`, `DashboardHeader.tsx`, `KPICard.tsx`, `MetricCard.tsx`, `SpeedometerGauge.tsx`, `FunnelChart.tsx`
- Hooks: `useDashboardMetrics(month, year, filterMemberId?)` (RPC `get_dashboard_metrics`), `useOraculoChat()`, `useTeamGoals(month, year)`
- Edge Functions: `oraculo-comercial` (tab Inteligencia)
- Tabelas: `goals`, `leads`, `pipe_propostas`, `pipe_confirmacao`, `oraculo_usage`

- [ ] **Step 3: Write Dashboard Outbound.md**

Data:
- O que faz: Dashboard simplificado para membros de orgs outbound. Greeting, metricas chave (leads recebidos, taxa resposta, reunioes agendadas, vendas fechadas) com setas mês-a-mês. Badges de milestone com gamificacao.
- Componentes: `src/pages/DashboardOutbound.tsx`, `OutboundMetricCards.tsx`, `MilestoneTracker.tsx`, `BadgeGrid.tsx`
- Hooks: `useOutboundMetrics()`, `useBadges()`, `useUserBadges(teamMemberId)`, `useMilestoneAutoUnlock()`
- Tabelas: `badges` (criteria_type, criteria_value, icon), `user_badges` (unlocked_at)

- [ ] **Step 4: Write Analytics Comercial.md**

Data:
- O que faz: Analytics avancado para master admins. Member stats (handles, propostas, wins, receita, avg ticket), loss reasons, origin quality (conversao e ticket por source). Filtros por data, membro, e origem.
- Componentes: `src/components/analytics/tabs/`, `AnalyticsFilters.tsx`, `ReceitaSection.tsx`, `EquipeSection.tsx`, `PipelineSection.tsx`, `AquisicaoSection.tsx`
- Hooks: `useAnalyticsComercial()` (RPC `get_analytics_commercial_metrics`), `useAnalyticsFilters()`
- Tabelas: `leads`, `pipe_propostas`, `team_members`, `products`

- [ ] **Step 5: Write Analytics UTMs.md**

Data:
- O que faz: Explorer hierarquico de UTMs (campaign → adset → ad → leads). Metricas: total leads, conversoes, CPL, CAC, ROAS. Combina dados do Supabase com Meta Ads spend.
- Componentes: `src/components/analytics/tabs/UtmsTab.tsx`
- Hooks: `useAnalyticsUtms(level, campaign?, adset?, ad?)` — retorna items[], leads[], kpis { totalLeads, totalSpend, avgCpl, avgConversionRate, roas, cac }
- Edge Functions: `meta-ads-insights` (puxa dados Meta Ads)
- Tabelas: `leads` (utm_data), Meta Ads Insights (externo, sincronizado)

- [ ] **Step 6: Write Performance.md**

Data:
- O que faz: Pagina unificada com 4 tabs — Ranking (leaderboard realtime), Metas (progresso individual/time), Premiacoes (badges e awards), Gestao de Metas (CRUD admin). Combina ranking, metas, premiacoes e gestao num unico lugar.
- Componentes: `src/pages/Performance.tsx`, `CompetitionPodiumV2.tsx`, `CompetitionRankingListV2.tsx`, `GoalProgress.tsx`, `AchievementBadge.tsx`, `CelebrationEffect.tsx`, `ProgressRing.tsx`
- Hooks: `useRankingData(month, year)` (RPC `get_ranking_data`), `useTeamGoals()`, `useIndividualGoals()`, `useAwards()`, `useCompetitions()`, `useCreateGoal()`, `useUpdateGoal()`, `useDeleteGoal()`, `useCreateAward()`, `useUpdateAward()`, `useDeleteAward()`
- Tabelas: `goals` (type, target_value, current_value, month, year, team_member_id), `awards` (type: meta_mensal/campeonato/bonus/especial, threshold, prize_value), `competitions`, `competition_participants`

- [ ] **Step 7: Write Ranking.md**

Data:
- O que faz: Leaderboard realtime por vendas (MRR/Projeto) ou reunioes agendadas. Top 3 com icones (Crown, Medal, Award). Atualiza via realtime subscription em pipe_propostas.
- Componentes: `src/pages/Ranking.tsx` (redirect para /performance), `RankingHistoryChart.tsx`
- Hooks: `useRankingData(month, year)`, `useDashboardMetrics()`, `useAvatarMap()`
- Tabelas: `pipe_propostas`, `pipe_confirmacao`, `leads`, `goals`

- [ ] **Step 8: Write TV Dashboard.md**

Data:
- O que faz: Dashboard fullscreen para TV de escritorio. Metricas grandes, ranking simplificado, funil de vendas, AI Coach, competicao ativa com premios. Auto-refresh e toggle fullscreen.
- Componentes: `src/pages/TVDashboard.tsx`, `TVMetricsGrid.tsx`, `TVRankingSimple.tsx`, `SalesFunnel.tsx`, `AICoachSection.tsx`, `TVCompetitionBlockV2.tsx`
- Hooks: `useTVDashboardData()` (agrega tudo em paralelo), `useActiveCompetition()`, `useCompetitionParticipants()`, `useCompetitionPrizes()`, `useRankingData()`
- Tabelas: todas as core (leads, pipes, goals, competitions, team_members)

- [ ] **Step 9: Verify**

```bash
obsidian vault="Segundo Cerebro" files folder="Claude Code — Torque CRM/06 — Features/Analytics"
```

Expected: 7 files.

---

## Task 6: Create Feature Notes — Equipe (4 notes)

**Files:**
- Create: `06 — Features/Equipe/Gestao de Time.md`
- Create: `06 — Features/Equipe/Comissoes.md`
- Create: `06 — Features/Equipe/Metas.md`
- Create: `06 — Features/Equipe/Premiacoes.md`

- [ ] **Step 1: Create folder and write all 4 notes**

Data for each note available from exploration. Follow the feature template. Key points:
- **Gestao de Time**: CRUD de membros, roles (admin/membro), seat usage, invite via email, edge functions `create-org-user` e `assign-user-to-org`, tabela `team_members`
- **Comissoes**: Comissoes por venda (MRR/Projeto), filtro por membro/mes, chart de tendencia, tabela `commissions` (FK para pipe_propostas e team_members)
- **Metas**: Goals mensais time/individual (faturamento, clientes, reunioes, conversao), progress bars com expected vs actual, tabela `goals`
- **Premiacoes**: Awards com thresholds, badges gamificacao, celebration animations, tipos: meta_mensal/campeonato/bonus/especial, tabelas `awards`, `badges`, `user_badges`

- [ ] **Step 2: Verify**

```bash
obsidian vault="Segundo Cerebro" files folder="Claude Code — Torque CRM/06 — Features/Equipe"
```

Expected: 4 files.

---

## Task 7: Create Feature Notes — Integracoes (7 notes)

**Files:**
- Create: `06 — Features/Integracoes/WhatsApp Evolution.md`
- Create: `06 — Features/Integracoes/Meta Facebook.md`
- Create: `06 — Features/Integracoes/Google Calendar.md`
- Create: `06 — Features/Integracoes/TinyERP.md`
- Create: `06 — Features/Integracoes/Asaas Pagamentos.md`
- Create: `06 — Features/Integracoes/SZ Chat.md`
- Create: `06 — Features/Integracoes/n8n Orquestracao.md`

- [ ] **Step 1: Create folder and write all 7 notes**

Key data per note:
- **WhatsApp Evolution**: Evolution API proxy, QR code connect, webhook receiver (CONNECTION_UPDATE, MESSAGES_UPSERT), copilot batch 8s, human takeover 10min, TTS ElevenLabs, smartSplitMessage. Tabelas: `whatsapp_instances`, `channel_messages`
- **Meta Facebook**: OAuth callback, webhook (leadgen + messenger), send-meta-message, meta-ads-insights, refresh-meta-tokens (cron diario 2AM), HMAC validation. Tabelas: `meta_ad_accounts`, `meta_leadgen_configs`, `meta_pages`
- **Google Calendar**: OAuth 2.0, push notifications via watch channel, event cache sync, compromisso_date sync com leads, microservico Python separado. Tabelas: `google_calendar_tokens`, `google_calendar_events_cache`, `google_calendar_subscriptions`
- **TinyERP**: Connect/disconnect, sync products (paginated), push order (vendido → ERP), push upsell order, fetch NFe. Tabelas: `tinyerp_integrations`, `products`, `product_variants`, `tinyerp_product_mappings`
- **Asaas Pagamentos**: checkout-create-payment (PIX QR ou card), asaas-webhook (PAYMENT_CONFIRMED/OVERDUE/REFUNDED), checkout-provision-org. Tabelas: `organizations` (payment_status), `subscription_plans`
- **SZ Chat**: Webhook receiver (client_message, attendance_transfer, finish), sz-chat-send, batch 8s, human takeover. Tabelas: `sz_chat_configs`, `sz_chat_sessions`
- **n8n Orquestracao**: lead-webhook como gateway principal, 20+ workflows externos, fluxo Trello → n8n → CRM, webhook subscriptions bidirecionais

- [ ] **Step 2: Verify**

```bash
obsidian vault="Segundo Cerebro" files folder="Claude Code — Torque CRM/06 — Features/Integracoes"
```

Expected: 7 files.

---

## Task 8: Create Feature Notes — Admin (7 notes)

**Files:**
- Create: `06 — Features/Admin/Onboarding.md`
- Create: `06 — Features/Admin/Configuracoes.md`
- Create: `06 — Features/Admin/Permissoes Sistema.md`
- Create: `06 — Features/Admin/Checkout e Planos.md`
- Create: `06 — Features/Admin/API Docs.md`
- Create: `06 — Features/Admin/Webhooks.md`
- Create: `06 — Features/Admin/Master Admin.md`

- [ ] **Step 1: Create folder and write all 7 notes**

Key data per note:
- **Onboarding**: Wizard 6 steps (Perfil → Estrutura → Processo → Config → Ativacao → Revisao), gera sugestoes de config automaticamente, tabela `org_onboarding`
- **Configuracoes**: Hub com 8+ tabs (Tags, Notificacoes, WhatsApp, Integracoes, Webhooks, API, Geral, Help), tabelas `tags`, `organization_settings`
- **Permissoes Sistema**: RBAC 4 camadas (master → org admin → feature permissions → member permissions), `src/lib/permissions.ts`, `_shared/permission_engine.ts`, tabelas `feature_permissions`, `member_feature_permissions`, `team_member_permissions`. AREA FRAGIL.
- **Checkout e Planos**: Wizard 3 steps (Plano → Org → Pagamento), PIX QR ou card, pricing com cupons/desconto volume, edge functions `checkout-create-payment` e `checkout-provision-org`, tabelas `subscription_plans`, `plan_addons`
- **API Docs**: Documentacao interativa com code snippets (curl/Node/Python), endpoint explorer, definido em `src/lib/api-docs/endpoints.ts` e `code-generators.ts`
- **Webhooks**: Registro de webhooks outgoing (lead.created, pipe_*.updated, etc.), test manual, retry de falhas, tabelas `webhooks`, `webhook_deliveries`, edge function `process-webhook-deliveries` (cron 1 min, batch 100)
- **Master Admin**: Super-panel com 5 views (Orgs, Users, Audit, Operations, Features), runtime logs, job status, usage by org. Hooks: `useMasterAuth()`, `useMasterOperations()`, tabelas `runtime_logs`, `organization_audit_logs`

- [ ] **Step 2: Verify**

```bash
obsidian vault="Segundo Cerebro" files folder="Claude Code — Torque CRM/06 — Features/Admin"
```

Expected: 7 files.

---

## Task 9: Create Changelog and Backlog structure

**Files:**
- Create: `07 — Changelog/` folder with today's daily note
- Create: `08 — Backlog/` folder structure

- [ ] **Step 1: Create directories**

```bash
mkdir -p "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/07 — Changelog/individuais"
mkdir -p "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/08 — Backlog/backlog"
mkdir -p "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/08 — Backlog/em-progresso"
mkdir -p "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/08 — Backlog/concluido"
```

- [ ] **Step 2: Create today's daily note (2026-04-12.md)**

Initial content from recent git log — list recent commits with timestamps and files.

- [ ] **Step 3: Create a sample backlog item**

Create `08 — Backlog/concluido/second-brain-v2.md` — this very implementation as a completed item.

- [ ] **Step 4: Verify**

```bash
obsidian vault="Segundo Cerebro" files folder="Claude Code — Torque CRM/07 — Changelog"
obsidian vault="Segundo Cerebro" files folder="Claude Code — Torque CRM/08 — Backlog"
```

---

## Task 10: Post-commit hook setup

**Files:**
- Create: `scripts/obsidian-post-commit.sh` (shell script for Etapa 1)
- Create: `scripts/obsidian-feature-map.json` (path → feature mapping)
- Modify: `.claude/settings.json` (add hook config)

- [ ] **Step 1: Create the feature map JSON**

Write `scripts/obsidian-feature-map.json` with the complete path → feature name mapping from the spec.

- [ ] **Step 2: Create the post-commit shell script**

Write `scripts/obsidian-post-commit.sh`:
- Reads last commit via `git log -1 --format='%H|%s|%ai'`
- Reads changed files via `git diff-tree --no-commit-id --name-only -r HEAD`
- Creates/appends daily note at vault path `07 — Changelog/YYYY-MM-DD.md`
- Detects if commit prefix is significant (feat/fix/refactor/spec)
- If significant: outputs a marker file `.claude/last-significant-commit` for the Claude Code hook to pick up

- [ ] **Step 3: Configure hook in settings.json**

Add to `.claude/settings.json`:
```json
{
  "hooks": {
    "PostCommit": [
      {
        "command": "bash scripts/obsidian-post-commit.sh",
        "description": "Append commit to Obsidian daily changelog"
      }
    ]
  }
}
```

- [ ] **Step 4: Make script executable and test**

```bash
chmod +x scripts/obsidian-post-commit.sh
```

Test with a dry run.

---

## Task 11: Create /second-brain skill

**Files:**
- Create: `.claude/skills/second-brain.md` (skill definition)

- [ ] **Step 1: Write the skill file**

The skill should instruct the agent to:
1. Read recent git log since last run (stored in `.claude/last-second-brain-run`)
2. For each significant commit: create individual changelog note, detect features, update feature notes
3. Generate daily summary
4. Support parameters: `resumo`, `feature <nome>`, `backlog <titulo>`
5. Update `.claude/last-second-brain-run` timestamp

- [ ] **Step 2: Test skill invocation**

```bash
# In Claude Code:
/second-brain
```

---

## Task 12: Update CLAUDE.md with Segundo Cerebro section

**Files:**
- Modify: `/Volumes/Untitled/v8milennialsb2bv2-main/CLAUDE.md`

- [ ] **Step 1: Add Segundo Cerebro section**

Append the section from the spec (rules 1-5, paths table) to the project CLAUDE.md.

- [ ] **Step 2: Verify**

Read CLAUDE.md and confirm section is present and correctly formatted.

---

## Task 13: Update 00 — INDEX.md

**Files:**
- Modify: `00 — INDEX.md`

- [ ] **Step 1: Update INDEX with all new sections**

Add links to all 35 feature notes organized by domain, plus 07 — Changelog and 08 — Backlog sections.

- [ ] **Step 2: Verify**

```bash
obsidian vault="Segundo Cerebro" read file="00 — INDEX"
```

---

## Task 14: Final commit

- [ ] **Step 1: Commit all Obsidian notes**

```bash
git add "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/"
git add scripts/obsidian-post-commit.sh scripts/obsidian-feature-map.json
git add .claude/settings.json .claude/skills/second-brain.md
git add CLAUDE.md
git commit -m "feat(obsidian): second brain v2 — 35+ feature docs, auto-tracking, backlog"
```
