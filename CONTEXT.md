# CONTEXT.md — Torque CRM Domain Glossary

Canonical terms used across the system. No implementation details here — this is a glossary.

## Core Entities

- **Lead**: A person or company entering the sales funnel. Has name, company, phone, email, origin, rating (1-5 manual), qualification_score (0-100 auto), qualification_tier, tags, and assigned team members (SDR/Closer/Responsible).

- **Buying-Intent Signal**: A real-time, decaying, evidence-backed hotness score (0-100) assembled from explicit buying signals surfaced during a conversation (pricing/MOQ question, "preciso pra semana que vem", sending a CNPJ/PO, asking lead-time). Distinct from **Qualification Tier**: the tier is a slow lead-quality verdict; the intent signal is "hot RIGHT NOW" and fires real-time actions (handoff, owner notification, cadence change). Both derive from the same extracted signals.

- **Lead Fact Memory**: A durable, agent-curated ledger of stable facts about a Lead (CNPJ, segment, monthly volume, payment terms negotiated, preferred carrier, decision-maker name, known objections) with confidence + provenance + decay. Distinct from **conversation history** (ephemeral, summarized away) and from **Lead 360** (a point-in-time read of CRM columns) — the fact memory persists across conversations and is authored by the agent itself.

- **Cotação (Quote)**: A priced order proposal a Copilot (Vendedor archetype) assembles: line items by SKU + quantity, with MOQ (minimum order quantity) enforcement, a quantity→unit-price tier table, and computed subtotal/IPI/total. Pricing is deterministic (client-configured tiers), never LLM-guessed. Distinct from **Deal** (the broader monetary negotiation record) — a Cotação is one concrete priced offer within it.

- **Qualification Tier**: A first-class enum ranking a Lead's commercial quality: `diamante > ouro > prata > bronze > desqualificado`. Distinct from **Tag** (free-form N:N label, even when a tag happens to be named "Ouro"), from **qualification_score** (0-100 numeric), and from **rating** (1-5 manual human judgment) and **lead_temperature** (hot/warm/cold engagement). Owned by the Qualifier archetype of the Copilot Agent (or set manually). The tier is decided by a deterministic rubric (client-defined thresholds over B2B signals: revenue, purchase volume/recurrence, ICP fit, urgency, region); the LLM only extracts the signals, it does not "judge" the tier.

- **Funnel Health Indicator (Saúde do Funil)**: A manager-facing analytics view of the lead journey as six blocks — Leads → Tratado → Qualificado → Agendado → Compareceu → Vendido — with conversion rates between blocks judged against fixed product benchmarks (>90, >40, >30, >65, >25%) via traffic-light status. Default semantics are **cohort**: the filter is the Lead's *creation* period, and each block counts cohort members that have *ever* reached it (a toggle switches to activity-in-period counting). Blocks are stage-agnostic: Tratado/Qualificado derive from the Effective Tier, Agendado/Compareceu from meeting events, Vendido from a final-positive Orçamentos outcome — so the indicator works unchanged for orgs with customized funnels. Each block drills down by Effective Tier and by **Pré-vendas** (single attribution across all six blocks, including Vendido). Visible to the whole Organization, like Performance.

- **Effective Tier (Tier Efetivo)**: The single Qualification Tier a Lead counts as in metrics when it carries both a pre-qualification and a final qualification: the final qualification always wins (it is the better-informed, post-conversation verdict); the pre-qualification only stands while no final tier exists. A Lead pre-qualified `diamante` then qualified `prata` counts as `prata` — including a final `desqualificado` overriding a positive pre-tier.

- **Lead Tratado (Treated Lead)**: A Lead whose quality has been assessed — it carries an Effective Tier, *any* tier including `desqualificado` (being judged unfit is still treatment; only the absence of any tier means untreated). Funnel-health block 2.

- **Lead Qualificado (Qualified Lead)**: A Lead whose Effective Tier is `prata`, `ouro`, or `diamante`. `bronze` is treated but NOT qualified (too weak to advance); `desqualificado` is treated but not qualified. Funnel-health block 3 — a strict subset of Lead Tratado.

- **Pipeline**: A sequence of stages a Lead moves through. System pipes: `pipe_whatsapp` (**Oportunidades** — qualification *and* meeting lifecycle), `pipe_propostas` (**Orçamentos** — closing), `custom_pipelines` (user-defined). A Lead can exist in multiple pipelines simultaneously. **`pipe_confirmacao` (Agendamentos) is being folded into Oportunidades** — its 6 reminder stages (`confirmar_d5/d3/d2/d1`, `confirmacao_no_dia`) collapse into a card-level Meeting Confirmation Status; only the meeting *outcome* stages survive (Agendado, Remarcar, Compareceu, Não compareceu). Milennials-first rollout. The standalone Agendamentos board is retired.

- **Stage**: A named step within a Pipeline. Dynamic per pipeline via `pipeline_stages`. The merged Oportunidades funnel is linear: `novo → abordado → respondeu → esfriou → agendado → remarcar → compareceu → nao_compareceu`. Reaching `compareceu` auto-creates an entry in Orçamentos. True loss is a loss-reason action, not a stage.

- **Meeting Confirmation Status**: A card-level state on a Lead in the `agendado` stage tracking whether the booked meeting is confirmed: `pendente → pre_confirmado → confirmado`. Driven by a date-aware button on the kanban card (label is "Pré-confirmar" before the meeting calendar-day, "Confirmar" on the day, in the Organization's timezone). Manual-only in v1 (the Copilot may send reminders but never sets the status). Distinct from a **Stage** (the Lead stays in `agendado` throughout) and from `is_confirmed` (the legacy boolean this 3-state enum supersedes). Resets to `pendente` when the meeting is rescheduled (Remarcar → new meeting_date).

- **Deal**: A monetary negotiation attached to a Lead. Has value, items, and lifecycle (open → closed_won / closed_lost). Distinct from Pipeline — Deal tracks money, Pipeline tracks progress.

- **Conversation**: A WhatsApp thread between the system and a phone number. Contains Messages. Belongs to an Organization.

- **Message**: A single inbound or outbound communication unit within a Conversation. Types: text, audio, image, video, document, sticker, menu, pix_button.

- **Copilot Agent**: An AI agent that processes inbound WhatsApp messages and generates responses. Canonical model has three **Archetypes**, each with its own Torque-owned, immutable base prompt; the client never edits the base prompt, only fills structured config slots:
  - **Qualificador (Qualifier)**: works inbound NEW/cold ad/WhatsApp leads — qualifies, sets the Qualification Tier, schedules discovery, then hands off the qualified Lead to the Vendedor (via stage move).
  - **Vendedor (Salesperson)**: works qualified Leads — sends proposals/material, negotiates, closes, schedules meetings, sends approved media.
  - **Carteira (Post-sale)**: works existing customers already in the Carteira — drives reorder, upsell, and win-back (resgate) for dormant clients. Reads the Carteira segment (ouro/prata/novo/resgate/dormindo), NOT the Qualification Tier (different scales — must not be conflated).
  An Organization enables any subset, at most one of each archetype. Routing is deterministic by **contact status** (`get_contact_status(phone)` → NOVO / LEAD_NO_PIPELINE → Qualificador; qualified → Vendedor; CLIENTE_CARTEIRA → Carteira) plus the Lead's stage — never complex per-agent rules. (Legacy v1 types — sdr, followup, agendador, prospectador, custom — are deprecated by this three-archetype model.)

- **Human Pause**: A time-bound suspension of a Copilot Agent's responses for a specific Conversation, triggered automatically when a human team member sends a message. The pause resets on each subsequent human message and expires after a configurable duration (default 60 minutes). Distinct from AI Disabled (permanent toggle) and Transfer to Human (agent-initiated state change).

- **Workflow**: A directed graph of automated steps — **may contain cycles**, bounded per-node by `loop_limit` (executor hard cap 500 steps); it is NOT strictly acyclic (e.g. the "Nutrição Infinita" template loops through a wait node). Has exactly one **trigger** node (the entry, no incoming edges). Triggered by domain events (lead_created, stage_changed, tag_added, cron, …). Node types: trigger, action, condition, delay, wait_response, split_ab, copilot, webhook_call, wait_business_window, goto, assign_responsible, end.

- **WhatsApp Message Node (Enviar Mensagem)**: A single Workflow action node that can send **any one** WhatsApp (Uazapi) message type, chosen via a **Message Type** selector — collapsing the former four separate nodes (`send_whatsapp`, `send_whatsapp_audio`, `send_whatsapp_image`, and the standalone `generate_ai_message`) into one. It sends **exactly one message per execution** (not a sequence/composer); the config form swaps to match the selected type. Three axes are kept separate: *content* (the chosen Message Type), *channel* (WhatsApp here; **Meta message** and **Meta Template/HSM** stay as their own nodes because the API and capabilities differ), and *delivery* (a node-level **semi-automatic** toggle that routes the message through SDR approval before send instead of auto-sending). The legacy four action types stay alive for already-saved DAGs and are lazily auto-upgraded to the new node on editor load. Backed by a new `send_whatsapp_message` action type carrying a `messageType` discriminator plus that type's config.

- **Message Type**: The single content kind a WhatsApp Message Node sends: `Texto`, `Imagem`, `Áudio`, `Sticker`, `Menu` (Uazapi interactive), or `Botão PIX` (Uazapi). `Texto` has three authoring modes — `Escrever` (free), `Template` (campaign template), and `Gerar com IA` (a prompt generates the message into a variable, default `{{ai_message}}`, which the same node then sends — preserving today's generate-then-send model without a second node). `Áudio` has `Gravar` / `Template`. All text-bearing types resolve **Template Variables** at send time.

- **Campaign**: A time-bound sales initiative parallel to pipelines. Has objective, deadline, AI agent, goals, round robin assignment, and message sequences. A Lead can be enrolled in multiple campaigns.

- **Follow-up**: Umbrella term for a scheduled future re-contact with a Lead. Two distinct kinds that must **not** be conflated:
  - **Copilot Follow-up (Re-engagement Cadence)**: an autonomous WhatsApp re-engagement sequence the Copilot sends when a Lead goes silent. Owned by whichever **Archetype currently owns the Lead** (Qualificador / Vendedor / Carteira) — there is no separate "followup" agent. It fires only from a fixed set of canonical **Follow-up Situations** (never from a generic "last message was ours + N hours" timer). Torque owns the situation set and the default cadence + copy; the Organization only enables/disables each situation and tunes basics (number of touches, spacing, optional copy override). Each touch's text is a Torque-authored base, optionally refined by the LLM from live conversation context (base text is the fallback). A cadence **stops** when any of: the Lead replies, the Lead opts out, steps are exhausted, the owning human replies (cancel — not merely pause), the triggering Situation is resolved (e.g. the proposal reaches `vendido`), or the Lead's owner changes (the old cadence dies; the new owner may start its own).
  - **Follow-up Task**: a human to-do created for a Team Member to contact a Lead — **no message is sent automatically**. Distinct from Copilot Follow-up by actor (human vs Copilot) and output (a task row vs a WhatsApp message).

- **Follow-up Situation**: One of the fixed, Torque-owned moments that can trigger a Copilot Follow-up, each bound to a funnel position and an owning Archetype, with its own timing, tone, and stop rule. The canonical seven: (Qualificador) **new Lead approached, no reply**; **qualified, no meeting booked**; **cold re-engage** (a Lead parked in a nurture/holding stage that went quiet); (Vendedor) **meeting reminder** (reminder only — the Copilot never sets the Meeting Confirmation Status); **no-show → rebook**; **proposal sent, no reply**; (Carteira) **dormant client → win-back**. A Situation is configured (on/off + basics), never authored from scratch by the Organization. Which of the org's stage_keys map to each Situation is set by `trigger_stage_keys` and populated automatically by an **AI Stage Classifier** (an LLM reads stage names + the `is_final_positive`/`is_final_negative` flags), never hardcoded — see ADR-0006.

- **Custom Field (Campo Personalizado)**: A per-Organization dynamic Lead attribute defined in `lead_custom_fields` (with a `field_type`: text/number/date/select/boolean). Its `field_name` is the human label — often phrased as a form question (e.g. "Qual o tipo do seu negócio?") — and doubles as the field's key. Per-Lead answers live in `lead_custom_field_values`. Referenced in message templates as `{{custom.<field_name>}}` (matched on exact `field_name`). Distinct from the Lead's built-in columns (name, company, …) and from a Tag (a label, not a key/value).

- **Tag**: A free-form, N:N label attached to a Lead (`tags` + `lead_tags`), scoped to an Organization. A Lead can carry several. Distinct from **Qualification Tier** (a ranked enum, even when a tag happens to be named "Ouro") and from a **Custom Field** (a key/value attribute, not a label).

## Post-Sale

- **Carteira (Customer Portfolio)**: Standalone post-sale module — a top-level feature (its own topbar entry next to Agenda), **not a Pipeline and not a kanban**. A table/analytics surface over `upsell_clients`: client health scoring, segmentation (ouro/prata/novo/resgate/dormindo), reorder cycle prediction, churn probability, retention actions, bulk operations. Retires the legacy "Upsell" kanban (the `upsell_base` / `upsell_gestao` pipe-type boards, labeled "Carteira Base" / "Carteira Gestão") — those are removed. **Carteira entry is deterministic-by-sale**: an Orçamento reaching `vendido` creates the Carteira Client (via `handle_proposta_vendida` trigger). A single optional Stage destination **"Carteira"** also lets any funnel's success stage admit a Lead manually (idempotent on `organization_id + lead_id`, lands in segment `novo`); this replaces the two dead legacy destinations. Distinct from Pipeline (Carteira tracks recurring post-sale relationship by segment, not stage progression).

- **Order**: A purchase record linked to a Carteira client. Has items, approval workflow, and ERP sync capability.

## Team & Organization

- **Organization (Org)**: A tenant. All data is scoped by `organization_id`. Represents a customer company using Torque CRM.

- **Team Member**: A salesperson within an Organization. Has roles and assignment types (Pré-vendas, Closer). Tracks commissions and goals.

- **Pré-vendas (Pre-Sale Responsible)**: The Team Member accountable for a Lead's pre-sale work — qualification and meeting booking. The ONLY canonical pre-sale assignment on a Lead. Meeting metrics credit the Pré-vendas. Legacy aliases `SDR` (`sdr_id`) and the generic `Responsible` (`responsible_id`) are deprecated and slated for cleanup; during transition they act only as fallback when the canonical field is empty.

- **Closer (Sale Responsible)**: The Team Member accountable for a Lead's sale — proposals, negotiation, closing. The ONLY canonical sale assignment on a Lead. Sales metrics and commissions credit the Closer. Legacy alias `closer_id` is deprecated (fallback-only during transition).

- **Role (code)**: Always one of `admin`, `master`, `membro`. SDR/Closer are UI/docs labels only, not code roles.

## Metrics

- **Stage Role**: The single, exclusive semantic role a Stage plays in metrics: `open` (default), `meeting_booked`, `meeting_held`, `won`, or `lost`. Chosen from a closed list — a Stage has exactly one role, so contradictory states (won AND lost) are impossible by construction. Metrics read ONLY the role, never the stage's name/key — renaming a stage never changes any metric. Distinct from `is_final_positive`/`is_final_negative` (board-UI semantics: "end of this board", which conflates Vendido/Compareceu/Agendado and must not be read by metrics).

- **Revenue Stream**: The mandatory dimension stamped on every sale at the moment it happens, splitting revenue into `novo_negocio` (a new client's first purchase) vs `carteira` (a repurchase/upsell from an existing Carteira client). Determined **by the client, not the funnel**: if the Lead already has a Carteira Client record at sale time → `carteira`; otherwise → `novo_negocio`. A returning Carteira client closing through the regular Orçamentos funnel still counts as `carteira`. One single sales ledger holds both; dashboards always display the two streams separately, and the total is their sum by construction — there is no second, separate "Carteira revenue" source of truth.

- **Metric Period (Período)**: The date range a metric is computed over, always cut in the **Organization's timezone** (org-level setting, default America/Sao_Paulo). Period boundaries are resolved exclusively by the database — the frontend names the period ("June 2026", a preset, a range) and never converts dates itself. One sale, one period, identical number on every screen.

- **Venda (Sale Event)**: The countable, immutable event of a Lead entering a `won` Stage Role — the ONLY thing sales/revenue metrics count (never current kanban state). Carries the sale date (**always the moment the sale was recorded** — never user-editable, never backdated), the value, the Revenue Stream stamp, and an attribution snapshot of the Lead's canonical **Closer** (and Pré-vendas) at that moment; later owner changes never rewrite it. Commissions are a projection of Sale Events — ledger equals metric by construction.

- **Estorno de Venda (Sale Reversal)**: The compensating event appended when a Lead leaves a `won` stage (mis-drag or genuinely unwound deal). Nothing is edited or deleted — the reversal references the original Sale Event and the pair annuls in every read, restoring the original period's numbers. Reversals are themselves countable (audit: who reversed, when) and cascade to the projected commission automatically.

- **Reunião Marcada (Meeting Booked)**: The countable event of a meeting being scheduled for a Lead. Credits the Lead's **Pré-vendas** in the period the booking happened. Distinct from Reunião Realizada — booking is the pre-sale output metric. **Reschedules do not count as a new booking** (including after a no-show): the same meeting keeps its one `meeting_booked` event with an updated meeting_date. A reschedule only becomes a NEW booking when the new meeting_date differs from the previous one by **more than 30 days**.

- **Reunião Realizada (Meeting Held)**: The countable event of a booked meeting actually happening (`compareceu`). Credits the Lead's **Pré-vendas** in the period of the meeting date. Distinct from Reunião Marcada — held is the quality/outcome metric. Goals can target either kind independently (`reunioes_marcadas` / `reunioes_realizadas` are separate goal types; the legacy single `reunioes` goal type measured held only).

- **Produtividade (Activity-in-Period Indicator)**: An Organization-wide block on the Performance page counting **what was *done* in a date range** — four counts: **Novos leads**, **Reuniões Marcadas**, **Reuniões Realizadas** (Comparecidas), and **Vendido**. Its defining trait: every count is keyed to the **date of the action itself** (the event's occurrence — booking date for Marcada, meeting date for Comparecida, sale date for Vendido, creation date for Novos leads), **never** to the Lead's creation/entry date. A Lead that entered in May whose meeting was booked in June counts in June — closing the gap where creation-cohort metrics silently drop cross-period activity. Filterable by a **free date range** (with presets) and optionally narrowed to a single **Team Member** (attribution = **Pré-vendas** for meetings, **Closer** for sales). Each count drills down to a per-Lead list with the exact action timestamp. Visible to the whole Organization, like the rest of Performance. Distinct from the **Funnel Health Indicator**: that view defaults to **cohort-by-creation** with conversion rates + traffic-light benchmarks for a manager audience, while Produtividade is **raw counts by action-date with per-Lead drill** for the whole team. (Funnel Health's activity-in-period toggle shares the date semantics but not the audience or the shape.)

## Communication

- **Message Gateway**: Single entry point for all outbound WhatsApp messages. Handles: instance resolution, phone normalization, dedup, rate limiting, provider dispatch, persistence, and structured logging.

- **Instance (WhatsApp)**: A WhatsApp phone number connection managed via Uazapi provider. An Organization can have multiple instances.

- **Mass Send (Disparo)**: A one-time bulk outbound broadcast to many phone numbers through a single Instance. Sourced from CSV paste or a lead selection. Tracked as a job with progress counters and pause/resume/stop controls. Distinct from Campaign (no stages, no enrollment, no rules) and Workflow (not event-triggered).

- **Quick Blast (Disparo Rápido)**: An ad-hoc Mass Send triggered directly from a kanban/list lead selection — "de supetão", without planning. Reuses the Mass Send dispatch core. Defining traits: no role gate (any logged-in member may fire it, scoped to their Organization by RLS), with an Organization-level cap on leads-per-blast as the safety guardrail instead of a permission; per-recipient personalization (variables + spintax) to reduce ban risk; optional single image; randomized inter-message delay. A Quick Blast is a Mass Send — same domain concept, different entry point and access policy.

- **Blast Audience**: The resolved set of Leads a Mass Send targets. Selected from a source — all Leads in a Stage, the Leads matching the board's active filter, or a manual card selection — then optionally narrowed by two refinements: **contact recency** (exclude Leads who already received a blast within a configurable window, default 7 days) and **reply status** ("não respondeu" = a Lead with zero inbound Messages after their most recent blast send). These refinements supersede the manual "Reencaminhar disparo" stage workaround some Orgs created to re-target non-responders by hand.

- **Daily Blast Budget**: An Organization-wide ceiling on how many Leads may be messaged via Mass Send per calendar day, summed across every blast — manual Quick Blasts and Blast Plan lots alike (default 200). Server-enforced, fail-closed. Supersedes the per-blast cap framing of ADR-0002: the guardrail is now throughput-per-day, not size-per-blast. A blast or lot that would exceed the remaining budget is truncated or deferred to the next day.

- **Blast Plan**: A Mass Send whose Audience exceeds one day's budget, sliced into daily lots over consecutive days. The Audience is **frozen at creation** (a snapshot — Leads that enter the source Stage afterward are not added); each lot is released by a daily job that re-applies the audience refinements (reply status, contact recency) at send time and consumes at most the remaining Daily Blast Budget. A Blast Plan is finite and self-terminating — distinct from a Workflow (event-triggered, standing) and a Campaign (stages + enrollment). It is "a blast spread over days," not a rule.

- **Blast Recipient Status**: The mutually-exclusive state of one Lead inside a Blast Plan, as the operator reads it: **Enviado** (dispatched through the number and not reported failed), **Falha na entrega** (the WhatsApp provider reported the send failed — invalid number, banned, rejected), **Pulado** (cut by a plan rule at release time — the Lead replied or was contacted too recently; the rule working, not a failure), **Aguardando** (not yet dispatched; belongs to a future lot). "Enviado" means accepted by the sending queue, not read-receipt; a Lead may move from Enviado to Falha na entrega asynchronously as the provider reports back. Falha na entrega is distinct from Pulado: broken delivery vs. deliberate refinement.

## Automation

- **Action Handler**: A function that executes a specific domain operation (move_stage, send_whatsapp, update_lead, etc.). Registered in a handler map and dispatched by the Workflow engine or Copilot.

- **Template Variable**: A `{{...}}` placeholder in an outbound message template, resolved per-Lead at send time by the Workflow message resolver. Three families: **built-in** (`{{nome}}`, `{{empresa}}`, `{{ai_resumo}}`, …) mapped to Lead/Pipeline/AI attributes; **Custom Field** (`{{custom.<field_name>}}`) → the Lead's answer for that field, empty if unanswered; **Tag** (`{{tag.<tag_name>}}`) → the tag name itself **if the Lead carries that tag, else empty** (a conditional echo, not a value lookup). All unresolved/absent values render as empty string (no fallback). The authoring UI offers a picker that lists the Organization's real Custom Fields and Tags so the author clicks instead of typing the key.

- **Dead Letter Event**: A domain event that was emitted but had no handler, or whose handler failed/timed out. Stored for audit and manual resolution.

## Intelligence

- **Oraculo Comercial**: A specialized Copilot variant that provides sales coaching and metric analysis. Not a separate domain — it's a Copilot agent type.

- **Copilot Builder**: An internal AI assistant that interviews the person creating a Copilot Agent and progressively fills the agent's configuration (prompt sections, tools, instructions, funnel wiring, knowledge). It builds an Agent; it is not itself a deployed Agent and never talks to Leads. Distinct from the Copilot Agent it produces.

- **Builder Session**: The persistent, re-openable conversation between a user and the Copilot Builder for a given Agent. Survives across visits — the user can return to review the interview history and continue revising the Agent with the Builder. Distinct from a (runtime) Conversation, which is between a deployed Agent and a Lead.

## Engagement

- **Checklist**: A template-driven task list attached to a Lead. A **template** Checklist (`lead_id` null) is the reusable definition; applying it to a Lead **copies** it — a per-Lead instance with its own items. A Lead may hold **many** Checklists at once (applied manually, by the `apply_checklist` Workflow action, or auto-attached when the Lead enters a Pipeline stage that names a template). Completion is tracked per item.

- **Checklist Item**: One task line on a Checklist, with a completed/not-completed state. A Lead's item is a **copy** of a template item and carries **lineage** back to it (`template_item_id`) — the stable identity that lets a Workflow address "this specific item" across the template→Lead copy, since the copy's own id is minted only at apply time. Renaming or reordering a Lead's item does not break the lineage. Distinct from an **Activity** (an item is a task to do; an Activity is the audit record of a thing already done).

- **Activity**: An audit log entry recording any domain action (call logged, email sent, stage moved, etc.). Consumer-only — records events from all modules.

- **Gamification**: Badges, awards, competitions, streaks, and milestones for sales team motivation.

## Billing

- **Subscription Plan**: A pricing tier for an Organization. Managed via Asaas payment gateway. Controls feature access via quotas and feature flags.

## Marketing

- **Lead Form**: An external capture form that feeds Leads into the system via `lead-webhook`. A **Meta Lead Form** is the native Lead Ads form, owned by a **Page** (not an Ad Account). Its submissions are pulled into Torque by **scheduled polling** of the Graph API (`/{form}/leads`, ~5 min cron) using the Torque Meta System User token — not a realtime webhook and no `lead-webhook` / Make hop. Polling was chosen over push because it needs zero per-app webhook configuration and fits the System-User-token + master-binding model; the cost is ~5 min latency, deemed irrelevant for B2B follow-up.

- **UTM**: Tracking parameters (source, medium, campaign) attached to Lead origin for marketing attribution.

- **Torque Meta System User**: The single, long-lived Meta System User token belonging to Torque's own Business Manager. Clients grant Torque **partner access** to their Meta assets (Pages + Ad Accounts); the System User token then reads/acts across all granted assets with one credential. Replaces the legacy **per-org OAuth** model (`meta_connections` / `meta_pages`, user-login-scoped tokens that expire ~60 days). A platform-level secret (service-role only), never per-org. Distinct from a Page Access Token (one page) and from an OAuth user token (one logged-in user).

- **Lead Conversion Signal (Meta)**: A CRM funnel event sent **back** to Meta (via the Conversions API, `action_source: system_generated`) keyed by the Lead's stored Meta lead id (`leadgen_id`), so Meta's **Conversion Leads** campaign optimization learns which ad-sourced Leads advance. Escalated (multiple distinct `event_name`s as the Lead progresses — e.g. qualified, meeting, sold), **never carrying a monetary value** (revenue is not exposed to Meta, by policy). Only fires for Meta-native-form Leads (those with a `leadgen_id` join key); Leads without one (e.g. click-to-WhatsApp ads, no form) cannot be signalled. Idempotent — each `event_name` is sent at most once per Lead. Requires the client's campaign to be configured for Conversion Leads optimization on the Meta side, else the event lands but does not optimize. Distinct from **meta-ads-insights** (reads ad metrics *in*; this writes Lead outcomes *out*).

- **Meta Asset Binding**: A master-managed link between an **Organization** and the Meta assets it owns — one or more **Pages** and one or more **Ad Accounts** (`act_…`). Set manually in the Master area by selecting, per Org, which assets (enumerated from the Torque Meta System User token) belong to it. Two purposes: a **Page** binding routes inbound Meta Lead Forms and messages to the Org; an **Ad Account** binding enables reading insights and sending conversion signals back (campaign optimization). A Page maps to exactly one Org (no fan-out). Supersedes the OAuth-populated `meta_pages.organization_id` as the source of truth for which Org a Meta asset feeds.

## Onboarding & Setup

- **Comece aqui (Setup Hub)**: A guided, revisitable onboarding hub at `/comecar` that teaches an Organization how to configure each system area in plain language and routes into the raw config screens to do it. **Distinct from Pitstop** (the `/configuracoes` Settings page — the raw config engine with tabs like WhatsApp, templates, API keys): the hub *teaches and points*, Pitstop *executes*. The hub never duplicates a Settings control; its action buttons deep-link into the right Pitstop tab or feature screen. Unlike the legacy one-time **Onboarding Wizard**, the hub is permanent and can be reopened any time to configure more.

- **Setup Area**: One configurable surface shown as a card in the Setup Hub. Each area has plain-language teaching (**O que é** / **Por que importa** / **Como configurar**) plus a mini-checklist of **Setup Steps**. Areas are split into **Essencial** (shown to every Org — Conectar WhatsApp, Funis, Combustível, Copilot/Agente IA, Pilotos/Equipe) and **Conforme seu uso** (shown only when the Org's plan **feature-flag** is on — e.g. Mensagens Meta, Automações, Disparos, Carteira, Metas/Comissões, Produtos, Templates, Agenda/TV). A flag that is off hides the area entirely.

- **Setup Step**: A single sub-task inside a Setup Area, marked done by **live detection of real data** (e.g. "WhatsApp connected" = an instance exists; "Has a funnel" = ≥1 pipeline; "Agent active" = a copilot agent is enabled) — never a manual checkbox. An area's completion **percentage is honest count-based**: detected steps ÷ total steps, not an arbitrary weighting.

- **Aha-moment (CRM)**: The point a new Org first feels the product's value — defined as the **AI agent (Copilot) holding/qualifying a real Lead conversation**. The Essencial setup spine is ordered to reach it fast (channel → funnel → fuel → agent). Drawn from the studied insight that the best onboarding sells the *outcome* and reaches value quickly, not lists features.

- **Onboarding Wizard** *(existing, legacy-adjacent)*: The one-time, full-screen first-run flow (`OnboardingWizard`) gated by `OnboardingGate`: a profile **quiz** (segment, ticket, cycle, team, SDR…) that auto-applies suggested pipelines, then team/WhatsApp/lead activation. Its quiz answers are reused by the Setup Hub's personalized hero ("Pro seu perfil … 3 funis + Bia qualificando 24/7"); an Org that skipped the quiz gets a neutral hero instead.

- **Primeiros passos (Checklist pill)**: The persistent, dismissible 6-step pill (`OnboardingChecklist`, Vercel/Linear style) that lives in the app header after the wizard. It is the **minimized form of the Setup Hub** — same progress source of truth — and expanding it / "ver tudo" opens `/comecar`. Not a separate progress model.
