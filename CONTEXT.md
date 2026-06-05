# CONTEXT.md — Torque CRM Domain Glossary

Canonical terms used across the system. No implementation details here — this is a glossary.

## Core Entities

- **Lead**: A person or company entering the sales funnel. Has name, company, phone, email, origin, rating (1-5 manual), qualification_score (0-100 auto), qualification_tier, tags, and assigned team members (SDR/Closer/Responsible).

- **Buying-Intent Signal**: A real-time, decaying, evidence-backed hotness score (0-100) assembled from explicit buying signals surfaced during a conversation (pricing/MOQ question, "preciso pra semana que vem", sending a CNPJ/PO, asking lead-time). Distinct from **Qualification Tier**: the tier is a slow lead-quality verdict; the intent signal is "hot RIGHT NOW" and fires real-time actions (handoff, owner notification, cadence change). Both derive from the same extracted signals.

- **Lead Fact Memory**: A durable, agent-curated ledger of stable facts about a Lead (CNPJ, segment, monthly volume, payment terms negotiated, preferred carrier, decision-maker name, known objections) with confidence + provenance + decay. Distinct from **conversation history** (ephemeral, summarized away) and from **Lead 360** (a point-in-time read of CRM columns) — the fact memory persists across conversations and is authored by the agent itself.

- **Cotação (Quote)**: A priced order proposal a Copilot (Vendedor archetype) assembles: line items by SKU + quantity, with MOQ (minimum order quantity) enforcement, a quantity→unit-price tier table, and computed subtotal/IPI/total. Pricing is deterministic (client-configured tiers), never LLM-guessed. Distinct from **Deal** (the broader monetary negotiation record) — a Cotação is one concrete priced offer within it.

- **Qualification Tier**: A first-class enum ranking a Lead's commercial quality: `diamante > ouro > prata > bronze > desqualificado`. Distinct from **Tag** (free-form N:N label, even when a tag happens to be named "Ouro"), from **qualification_score** (0-100 numeric), and from **rating** (1-5 manual human judgment) and **lead_temperature** (hot/warm/cold engagement). Owned by the Qualifier archetype of the Copilot Agent (or set manually). The tier is decided by a deterministic rubric (client-defined thresholds over B2B signals: revenue, purchase volume/recurrence, ICP fit, urgency, region); the LLM only extracts the signals, it does not "judge" the tier.

- **Pipeline**: A sequence of stages a Lead moves through. Four system pipes: `pipe_whatsapp` (qualification), `pipe_confirmacao` (meeting confirmation), `pipe_propostas` (closing), `custom_pipelines` (user-defined). A Lead can exist in multiple pipelines simultaneously.

- **Stage**: A named step within a Pipeline. Dynamic per pipeline via `pipeline_stages`.

- **Deal**: A monetary negotiation attached to a Lead. Has value, items, and lifecycle (open → closed_won / closed_lost). Distinct from Pipeline — Deal tracks money, Pipeline tracks progress.

- **Conversation**: A WhatsApp thread between the system and a phone number. Contains Messages. Belongs to an Organization.

- **Message**: A single inbound or outbound communication unit within a Conversation. Types: text, audio, image, video, document, sticker, menu, pix_button.

- **Copilot Agent**: An AI agent that processes inbound WhatsApp messages and generates responses. Canonical model has three **Archetypes**, each with its own Torque-owned, immutable base prompt; the client never edits the base prompt, only fills structured config slots:
  - **Qualificador (Qualifier)**: works inbound NEW/cold ad/WhatsApp leads — qualifies, sets the Qualification Tier, schedules discovery, then hands off the qualified Lead to the Vendedor (via stage move).
  - **Vendedor (Salesperson)**: works qualified Leads — sends proposals/material, negotiates, closes, schedules meetings, sends approved media.
  - **Carteira (Post-sale)**: works existing customers already in the Carteira — drives reorder, upsell, and win-back (resgate) for dormant clients. Reads the Carteira segment (ouro/prata/novo/resgate/dormindo), NOT the Qualification Tier (different scales — must not be conflated).
  An Organization enables any subset, at most one of each archetype. Routing is deterministic by **contact status** (`get_contact_status(phone)` → NOVO / LEAD_NO_PIPELINE → Qualificador; qualified → Vendedor; CLIENTE_CARTEIRA → Carteira) plus the Lead's stage — never complex per-agent rules. (Legacy v1 types — sdr, followup, agendador, prospectador, custom — are deprecated by this three-archetype model.)

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

- **Mass Send (Disparo)**: A one-time bulk outbound broadcast to many phone numbers through a single Instance. Sourced from CSV paste or a lead selection. Tracked as a job with progress counters and pause/resume/stop controls. Distinct from Campaign (no stages, no enrollment, no rules) and Workflow (not event-triggered).

- **Quick Blast (Disparo Rápido)**: An ad-hoc Mass Send triggered directly from a kanban/list lead selection — "de supetão", without planning. Reuses the Mass Send dispatch core. Defining traits: no role gate (any logged-in member may fire it, scoped to their Organization by RLS), with an Organization-level cap on leads-per-blast as the safety guardrail instead of a permission; per-recipient personalization (variables + spintax) to reduce ban risk; optional single image; randomized inter-message delay. A Quick Blast is a Mass Send — same domain concept, different entry point and access policy.

- **Blast Audience**: The resolved set of Leads a Mass Send targets. Selected from a source — all Leads in a Stage, the Leads matching the board's active filter, or a manual card selection — then optionally narrowed by two refinements: **contact recency** (exclude Leads who already received a blast within a configurable window, default 7 days) and **reply status** ("não respondeu" = a Lead with zero inbound Messages after their most recent blast send). These refinements supersede the manual "Reencaminhar disparo" stage workaround some Orgs created to re-target non-responders by hand.

- **Daily Blast Budget**: An Organization-wide ceiling on how many Leads may be messaged via Mass Send per calendar day, summed across every blast — manual Quick Blasts and Blast Plan lots alike (default 200). Server-enforced, fail-closed. Supersedes the per-blast cap framing of ADR-0002: the guardrail is now throughput-per-day, not size-per-blast. A blast or lot that would exceed the remaining budget is truncated or deferred to the next day.

- **Blast Plan**: A Mass Send whose Audience exceeds one day's budget, sliced into daily lots over consecutive days. The Audience is **frozen at creation** (a snapshot — Leads that enter the source Stage afterward are not added); each lot is released by a daily job that re-applies the audience refinements (reply status, contact recency) at send time and consumes at most the remaining Daily Blast Budget. A Blast Plan is finite and self-terminating — distinct from a Workflow (event-triggered, standing) and a Campaign (stages + enrollment). It is "a blast spread over days," not a rule.

## Automation

- **Action Handler**: A function that executes a specific domain operation (move_stage, send_whatsapp, update_lead, etc.). Registered in a handler map and dispatched by the Workflow engine or Copilot.

- **Dead Letter Event**: A domain event that was emitted but had no handler, or whose handler failed/timed out. Stored for audit and manual resolution.

## Intelligence

- **Oraculo Comercial**: A specialized Copilot variant that provides sales coaching and metric analysis. Not a separate domain — it's a Copilot agent type.

- **Copilot Builder**: An internal AI assistant that interviews the person creating a Copilot Agent and progressively fills the agent's configuration (prompt sections, tools, instructions, funnel wiring, knowledge). It builds an Agent; it is not itself a deployed Agent and never talks to Leads. Distinct from the Copilot Agent it produces.

- **Builder Session**: The persistent, re-openable conversation between a user and the Copilot Builder for a given Agent. Survives across visits — the user can return to review the interview history and continue revising the Agent with the Builder. Distinct from a (runtime) Conversation, which is between a deployed Agent and a Lead.

## Engagement

- **Checklist**: A template-driven task list attached to a Lead. Has items with completion tracking.

- **Activity**: An audit log entry recording any domain action (call logged, email sent, stage moved, etc.). Consumer-only — records events from all modules.

- **Gamification**: Badges, awards, competitions, streaks, and milestones for sales team motivation.

## Billing

- **Subscription Plan**: A pricing tier for an Organization. Managed via Asaas payment gateway. Controls feature access via quotas and feature flags.

## Marketing

- **Lead Form**: An external capture form that feeds Leads into the system via `lead-webhook`.

- **UTM**: Tracking parameters (source, medium, campaign) attached to Lead origin for marketing attribution.
