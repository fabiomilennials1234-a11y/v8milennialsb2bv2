# CONTEXT.md — Torque CRM Domain Glossary

Canonical terms used across the system. No implementation details here — this is a glossary.

## Core Entities

- **Lead**: A person or company entering the sales funnel. Has name, company, phone, email, origin, rating (1-5 manual), qualification_score (0-100 auto), tags, and assigned team members (SDR/Closer/Responsible).

- **Pipeline**: A sequence of stages a Lead moves through. Four system pipes: `pipe_whatsapp` (qualification), `pipe_confirmacao` (meeting confirmation), `pipe_propostas` (closing), `custom_pipelines` (user-defined). A Lead can exist in multiple pipelines simultaneously.

- **Stage**: A named step within a Pipeline. Dynamic per pipeline via `pipeline_stages`.

- **Deal**: A monetary negotiation attached to a Lead. Has value, items, and lifecycle (open → closed_won / closed_lost). Distinct from Pipeline — Deal tracks money, Pipeline tracks progress.

- **Conversation**: A WhatsApp thread between the system and a phone number. Contains Messages. Belongs to an Organization.

- **Message**: A single inbound or outbound communication unit within a Conversation. Types: text, audio, image, video, document, sticker, menu, pix_button.

- **Copilot Agent**: An AI agent that processes inbound WhatsApp messages and generates responses. Types: qualificador, sdr, followup, agendador, prospectador, custom. Has personality, capabilities, kanban rules, and business context.

- **Human Pause**: A time-bound suspension of a Copilot Agent's responses for a specific Conversation, triggered automatically when a human team member sends a message. The pause resets on each subsequent human message and expires after a configurable duration (default 60 minutes). Distinct from AI Disabled (permanent toggle) and Transfer to Human (agent-initiated state change).

- **Workflow**: A directed acyclic graph (DAG) of automated actions. Triggered by domain events (lead_created, stage_changed, tag_added, cron). Node types: trigger, action, condition, delay, wait_response, split_ab, copilot, webhook_call, wait_business_window.

- **Campaign**: A time-bound sales initiative parallel to pipelines. Has objective, deadline, AI agent, goals, round robin assignment, and message sequences. A Lead can be enrolled in multiple campaigns.

- **Follow-up**: A scheduled future contact with a Lead. Can be manual, automated by Workflow, or scheduled by Copilot. Has cadence rules and expiration.

## Post-Sale

- **Carteira (Customer Portfolio)**: Unified module for post-sale client management. Subsumes the legacy "Upsell" concept. Includes: client health scoring, segmentation (ouro/prata/novo/resgate/dormindo), reorder cycle prediction, churn probability, retention actions, and bulk operations. Backed by `upsell_clients` table.

- **Order**: A purchase record linked to a Carteira client. Has items, approval workflow, and ERP sync capability.

## Team & Organization

- **Organization (Org)**: A tenant. All data is scoped by `organization_id`. Represents a customer company using Torque CRM.

- **Team Member**: A salesperson within an Organization. Has roles and assignment types (SDR, Closer, Responsible). Tracks commissions and goals.

- **Role (code)**: Always one of `admin`, `master`, `membro`. SDR/Closer are UI/docs labels only, not code roles.

## Communication

- **Message Gateway**: Single entry point for all outbound WhatsApp messages. Handles: instance resolution, phone normalization, dedup, rate limiting, provider dispatch, persistence, and structured logging.

- **Instance (WhatsApp)**: A WhatsApp phone number connection managed via Uazapi provider. An Organization can have multiple instances.

## Automation

- **Action Handler**: A function that executes a specific domain operation (move_stage, send_whatsapp, update_lead, etc.). Registered in a handler map and dispatched by the Workflow engine or Copilot.

- **Dead Letter Event**: A domain event that was emitted but had no handler, or whose handler failed/timed out. Stored for audit and manual resolution.

## Intelligence

- **Oraculo Comercial**: A specialized Copilot variant that provides sales coaching and metric analysis. Not a separate domain — it's a Copilot agent type.

## Engagement

- **Checklist**: A template-driven task list attached to a Lead. Has items with completion tracking.

- **Activity**: An audit log entry recording any domain action (call logged, email sent, stage moved, etc.). Consumer-only — records events from all modules.

- **Gamification**: Badges, awards, competitions, streaks, and milestones for sales team motivation.

## Metrics & Dashboards

- **North Star Metrics**: The two top-level indicators of business health: Vendas Fechadas (new revenue engine) and Receita Recorrente (retention/reorder sustentation). All other metrics support or diagnose these two.

- **Dashboard Camada Estratégica ("Resultado")**: Executive-level view showing North Stars, funnel health, efficiency, and alerts. Visible to admin/master only.

- **Dashboard Camada Tática ("Time")**: Management-level view showing team performance, detailed funnel, diagnostics, and Copilot effectiveness. Visible to admin/master only.

- **Dashboard Camada Operacional ("Meus Números")**: Individual contributor view showing personal metrics, pending actions, and evolution. Visible to all roles. Default tab for membro.

- **Cobertura de Pipeline**: Ratio of total open deal value to the monthly sales target (meta). Indicates whether there's enough pipeline to hit the goal.

- **Leads Parados**: Leads with no activity (no messages, no stage changes, no notes) for 7+ days. An alert metric for stale pipeline.

- **Sequência de Vitórias**: Consecutive days a team member has recorded at least one sale (Closer) or attended meeting (SDR). Gamification metric.

- **Meta (Goal)**: A monthly target assigned to a Team Member (individual) or the whole team. Types: vendas, reunioes, faturamento, clientes, conversao.

## Billing

- **Subscription Plan**: A pricing tier for an Organization. Managed via Asaas payment gateway. Controls feature access via quotas and feature flags.

## Marketing

- **Lead Form**: An external capture form that feeds Leads into the system via `lead-webhook`.

- **UTM**: Tracking parameters (source, medium, campaign) attached to Lead origin for marketing attribution.
