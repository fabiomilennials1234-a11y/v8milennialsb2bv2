---
tags:
  - claude-code
  - arquitetura
  - torque-crm
created: 2026-04-12
last_updated: 2026-04-14
last_verified: 2026-04-14
status: active
source_of_truth:
  - src/pages/
  - src/hooks/
  - supabase/functions/
---

# Modulos e Componentes

## Resumo

Mapeamento dos modulos principais do Torque CRM: paginas, hooks, componentes, edge functions e shared modules. Cada modulo com sua responsabilidade e tabelas associadas.

> Contagens exatas sao geradas por `npm run docs:sync`. Nomes de paginas/hooks devem linkar para o arquivo real em `src/`.

## Pages (43 paginas, lazy loaded)

| Pagina | Responsabilidade |
|--------|-----------------|
| Dashboard | Metricas gerais da org |
| DashboardOutbound | Metricas de outbound/prospeccao |
| Leads | Lista e gestao de leads |
| PipeWhatsapp | Kanban de qualificacao WhatsApp |
| PipeConfirmacao | Kanban de confirmacao de reuniao |
| PipePropostas | Kanban de propostas/fechamento |
| CustomPipeline | Funis customizados por org |
| FunisHub | Hub central de todos os funis |
| Copilot | Agentes IA (config, wizard, gestao) |
| CopilotMetrics | Metricas de performance dos agentes |
| Automacoes | Workflows (lista) |
| AutomacoesEditor | Editor visual de workflows (DAG) |
| AutomacoesExecucoes | Historico de execucoes |
| Campanhas | Campanhas de vendas |
| CampanhaDetail | Detalhe de campanha |
| ChatWhatsApp | Chat multi-canal (WhatsApp, Meta, SZ.Chat) |
| Equipe | Gestao de time |
| Comissoes | Comissoes de vendas |
| Metas | Metas do time |
| GestaoMetas | Gestao de metas avancada |
| Performance | Performance individual |
| Ranking | Ranking de vendedores |
| Premiacoes | Sistema de premiacoes |
| Produtos | Catalogo de produtos |
| Configuracoes | Settings da org |
| Agenda | Google Calendar integrado |
| Upsell | Modulo de upsell/pos-venda |
| Checkout | Checkout de planos |
| Onboarding | Wizard de onboarding |
| ApiDocs | Documentacao da API |
| Revisao | Revisao de interacoes |
| MessageTemplates | Templates de mensagens |
| PipeFollowUps | Follow-ups pendentes |
| TVDashboard | Dashboard para TV (escritorio) |
| ChecklistPage | Checklists operacionais |
| master/ | Paginas do admin Milennials (cross-org) |

## Hooks principais (122+ hooks)

### Core

| Hook | Tabela(s) | Funcao |
|------|-----------|--------|
| `useLeads` | leads | Lista leads da org com filtros |
| `useUserRole` | team_members + profiles | Role do usuario logado |
| `useOrganization` | organizations | Dados da org atual |
| `useMasterAuth` | profiles | Bypass master admin |
| `useTeamMembers` | team_members | Time da org |

### Pipelines

| Hook | Tabela(s) | Funcao |
|------|-----------|--------|
| `usePipeWhatsapp` | pipe_whatsapp + leads | Kanban qualificacao |
| `usePipeConfirmacao` | pipe_confirmacao + leads | Kanban confirmacao |
| `usePipePropostas` | pipe_propostas + leads + products | Kanban propostas |
| `useCustomPipelines` | custom_pipelines + custom_pipe_entries | Funis customizados |
| `useLeadAllPipelines` | todas as pipes | Pipes de um lead |

### Copilot / IA

| Hook | Tabela(s) | Funcao |
|------|-----------|--------|
| `useCopilotAgents` | copilot_agents + copilot_agent_faqs | Agentes IA |
| `useCopilotPromptBuilder` | copilot_agents | Construcao de prompts |
| `useCopilotSubscription` | copilot_agents (realtime) | Realtime do copilot |
| `useConversationHistory` | conversations + conversation_messages | Historico de chat |
| `useConversationNotes` | conversation_notes | Notas de conversa |

### Automacoes / Campanhas

| Hook | Tabela(s) | Funcao |
|------|-----------|--------|
| `useWorkflows` | workflows | Automacoes |
| `useCampanhas` | campanhas + campanha_stages | Campanhas de vendas |
| `useCampaignTemplates` | campaign_templates | Templates de campanha |
| `useFollowUps` | follow_ups | Tarefas de follow-up |
| `useScheduledMessages` | scheduled_user_messages | Mensagens agendadas |

### Analytics

| Hook | Tabela(s) | Funcao |
|------|-----------|--------|
| `useAnalyticsOverview` | leads, pipes | Visao geral |
| `useAnalyticsComercial` | leads, pipe_propostas | Metricas comerciais |
| `useAnalyticsFinanceiro` | pipe_propostas, products | Metricas financeiras |
| `useAnalyticsEngajamento` | conversations, channel_messages | Engajamento |
| `useAnalyticsPipesFunis` | todas as pipes | Funis comparativos |
| `useAnalyticsUtms` | leads, utm_data | UTM tracking |
| `useDashboardMetrics` | leads, pipes | Dashboard metricas |

### Integracao

| Hook | Tabela(s) | Funcao |
|------|-----------|--------|
| `useChannelChat` | channel_messages + conversations | Chat multi-canal |
| `useGoogleCalendar` | google_calendar_connections | Integracao GCal |
| `useProducts` | products | Catalogo (TinyERP sync) |
| `useWebhooks` | webhook_endpoints + webhook_deliveries | Webhooks config |
| `useTags` | tags | Tags da org |

## Edge Functions (78+ funcoes)

### Webhooks de entrada

| Funcao | Origem | Destino |
|--------|--------|---------|
| `lead-webhook` | n8n, externos | Ingestao de leads |
| `evolution-webhook` | Evolution API | Mensagens WhatsApp |
| `meta-webhook` | Meta/Facebook | Mensagens Meta |
| `sz-chat-webhook` | SZ.Chat | Mensagens SZ.Chat |
| `asaas-webhook` | Asaas | Eventos de pagamento |
| `tinyerp-webhook` | TinyERP | Eventos do ERP |
| `google-calendar-webhook` | Google | Eventos de calendario |
| `webhook-calcom` | Cal.com | Agendamentos |

### Processamento (cron)

| Funcao | Frequencia | Batch |
|--------|-----------|-------|
| `process-webhook-deliveries` | 1 min | 100 |
| `process-workflow-executions` | 1 min | 20 |
| `process-outbound-dispatches` | 5 min | - |
| `process-ai-actions` | 1 min | - |
| `process-copilot-followups` | 5 min | - |
| `process-followup-automations` | 5 min | - |
| `process-scheduled-user-messages` | 1 min | - |
| `campaign-rule-dispatch` | 1 min | - |
| `pipe-rule-dispatch` | 1 min | - |
| `retry-dead-letter-jobs` | 5 min | - |
| `refresh-meta-tokens` | diario 2AM | - |

### IA / Copilot

| Funcao | Proposito |
|--------|-----------|
| `agent-message` | Processamento de mensagem do agente |
| `summarize-conversation` | Resumo de conversas |
| `evaluate-agent-conversation` | Avaliacao de conversa |
| `generate-agent-examples` | Gerar exemplos de conversa |
| `generate-business-context` | Gerar contexto de negocio |
| `generate-custom-instructions` | Gerar instrucoes customizadas |
| `generate-faq-embeddings` | Embeddings de FAQs (pgvector) |
| `generate-faqs` | Gerar FAQs automaticas |
| `oraculo-comercial` | Oraculo IA comercial |
| `calculate-lead-score` | Score automatico de lead |
| `test-copilot-chat` | Teste de chat do agente |
| `test-gemini-rag` | Teste de RAG com Gemini |

### Shared modules (_shared/ - 33 modulos)

| Modulo | Responsabilidade |
|--------|-----------------|
| `auth.ts` | Autenticacao e validacao de JWT |
| `user-auth.ts` | Autenticacao de usuario |
| `cors.ts` | Headers CORS |
| `security-headers.ts` | Headers de seguranca |
| `sentry.ts` | Integracao Sentry (withSentry wrapper) |
| `logger.ts` | Logging estruturado + runtime_logs |
| `response.ts` | Helpers de resposta HTTP |
| `validation.ts` | Validacao de input |
| `permission_engine.ts` | Engine de permissoes backend |
| `lead-service.ts` | Servicos de lead |
| `embeddings.ts` | Embeddings Gemini + pgvector |
| `ai-action-executor.ts` | Executor de acoes IA |
| `ai-queue.ts` | Fila de acoes IA |
| `workflow-executor.ts` | Executor de workflows |
| `workflow-action-handler.ts` | Handler de acoes de workflow |
| `workflow-condition-evaluator.ts` | Avaliador de condicoes |
| `workflow-trigger.ts` | Triggers de workflow |
| `natural-messaging.ts` | Humanizacao de mensagens |
| `message-humanizer.ts` | Humanizacao de mensagens |
| `outbound-sender.ts` | Envio outbound |
| `followup-sender.ts` | Envio de follow-ups |
| `audio-sender.ts` | Envio de audios |
| `meta-api.ts` | Client Meta/Facebook API |
| `tinyerp-utils.ts` | Utilitarios TinyERP |
| `asaas.ts` | Client Asaas |
| `google-calendar-utils.ts` | Utilitarios Google Calendar |
| `webhook-utils.ts` | Utilitarios de webhook |
| `campaign-distribution.ts` | Distribuicao de campanhas |
| `job-tracker.ts` | Rastreamento de jobs async |
| `track.ts` | Tracking de eventos |
| `time-variables.ts` | Variaveis de tempo |
| `tts-elevenlabs.ts` | Text-to-speech ElevenLabs |
| `followupSchedule.ts` | Agendamento de follow-ups |

## Contexts (3)

| Context | Responsabilidade |
|---------|-----------------|
| `AuthContext` | Sessao, signIn/signUp/signOut, auto-attach a org |
| `OrgFeaturesContext` | Feature gating, limites de plano, hasFeature/checkLimit |
| `ThemeTransitionContext` | Transicao animada dark/light mode |

## Links relacionados

- [[MOC - Arquitetura]]

- [[Produtos]]

- [[Analise Logging SaaS]]

- [[Pipelines Customizados]]

- [[Checkout e Planos]]

- [[Master Admin]]

- [[Premiacoes]]

- [[Metas]]

- [[Gestao de Time]]

- [[Comissoes]]

- [[Mensagens Agendadas]]

- [[Onboarding]]

- [[Webhooks]]

- [[n8n Orquestracao]]

- [[Permissoes Sistema]]

- [[SZ Chat]]

- [[Dashboard]]

- [[Ranking]]

- [[Upsell]]

- [[Follow-ups]]

- [[Campanhas]]

- [[Oraculo Comercial]]

- [[Asaas Pagamentos]]

- [[Google Calendar]]

- [[TinyERP]]

- [[Pipe Propostas]]

- [[Pipe Confirmacao]]

- [[Pipe WhatsApp]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[Visao Geral]]
- [[Integracoes]]
- [[00 - INDEX]]

## Notas do agente

> Fonte: `ls` de src/pages/, src/hooks/, src/components/, supabase/functions/, supabase/functions/_shared/.
> A contagem exata pode variar - hooks e componentes sao adicionados frequentemente.
