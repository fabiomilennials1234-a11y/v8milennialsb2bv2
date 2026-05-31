# ADR-0002: Copilot v2 — Clean-Slate Agent Runtime

- **Status**: Accepted
- **Date**: 2026-05-29
- **Decision makers**: Gabriel (CTO)
- **Supersedes**: incremental v1 patches — `.specs/features/copilot-structured-prompt`, `.specs/features/copilot-media-knowledge-base`, `.specs/features/copilot-fallback-elimination`
- **Source material**: 5 reference web-clips in `Motor100/Obsidian/Clippings` — modular monolith (Galego), LLM tracing/eval (Langfuse), cumulative guardrails, layered WhatsApp agent harness, RAG 3.0. Grounded in `CONTEXT.md` (canonical glossary) + full recon of the v1 Copilot (DB, turn loop, tools, config UI).

## Context

The v1 Copilot is the most fragile flow in the product. Two root causes, measured by recon:

**Over-personalization.** `copilot_agents` carries 50+ columns and ~20 free-text JSONB fields (`business_context`, `conversation_style`, `qualification_rules`, `custom_instructions`, `behavior_windows`, `anti_patterns`, `intent_detection`). Every client reinvents structure with no schema. The client edits the system prompt directly and pastes free-form `custom_instructions` — the prompt degrades into spaghetti. Six stacked wizard versions left brittle `IF NOT EXISTS ADD COLUMN` debt.

**Instability.** Capabilities (`can_*` flags) are loaded but **never gate actions** at runtime — the LLM can call `SCHEDULE_MEETING` with `can_schedule_meeting=false`. There is no tool-call budget, no end-to-end trace, no LLM-level retry. The prompt is assembled from ~20 sections (~9k tokens typical) with silent truncation. `bot-loop-detector.ts` exists but was never wired in (incident: Bertin, bot↔bot 3000+ messages in 9h). Multiple prompt-generation paths have undefined precedence. Several actions (`UPDATE_CRM`, `SEND_FOLLOWUP`) are NOOP placeholders that enqueue and silently vanish.

The proposal no longer matches the business. Clients are B2B factories, distributors, and industries with a distinct post-sale (reorder/upsell) motion that v1 does not model.

## Decision

Rebuild the Copilot **agent runtime** from scratch — new edge function, new tables, isolated from v1 — driven by a strict, reusable config contract. Twelve decisions:

### 1. Three archetypes, deterministic routing

Replace the six legacy v1 types with **three archetypes**, each owning a Torque-authored, immutable base prompt:

- **Qualificador** — new/cold leads (ads, WhatsApp): qualifies, sets `qualification_tier`, schedules discovery, hands off to Vendedor.
- **Vendedor** — qualified leads: proposal, negotiation, close, meetings, approved media.
- **Carteira** — existing customers already in the portfolio: reorder, upsell, win-back (resgate) of dormant clients.

An Organization enables any subset, at most one of each. Routing is deterministic by `get_contact_status(phone)` (NOVO / LEAD_NO_PIPELINE → Qualificador; qualified → Vendedor; CLIENTE_CARTEIRA → Carteira) plus the lead's stage — never the complex per-agent `routing_stages/origins/segments` of v1.

### 2. Clean-slate, incidents become regression tests

New edge function + new tables. The full runtime — including hardened primitives (dedup lock, phone-keyed pause, loop detector, queue retry, phone normalization) — is rewritten, not ported. **Binding condition:** every past production incident is re-derived as an explicit invariant + regression test in the eval dataset, so a from-scratch rewrite does not re-bleed solved bugs. Incidents to encode: human-pause phone-keyed (40% of `ai_disabled` once broken by malformed `normalized_phone`), Bertin bot-loop, dedup race, `increment_conversation_turn` race, `is_group` empty-chat.

### 3. Hybrid qualification

The LLM only **extracts B2B signals** (revenue, purchase volume/recurrence, ICP fit, urgency, region) from the conversation. A **deterministic rubric** — thresholds filled by the client — maps signals → `qualification_tier` (`diamante > ouro > prata > bronze > desqualificado`). The LLM never "judges" the tier. Carteira uses its own portfolio segment (ouro/prata/novo/resgate/dormindo), never the qualification tier — different scales, not to be conflated.

### 4. Strict config contract with a guarded escape-hatch

The base prompt is Torque-owned and immutable; the client never edits it. The client fills typed slots only — a 12-section form (company, products, ICP, qualification rubric, objections, social proof, commercial policy, media, scheduling, human transfer + notification, tone, hours), with archetype-specific qualification/objective sections. The only free text is a single per-archetype "specific notes" field, capped at ~500 chars and validated by an LLM-linter that rejects conflicts with the base prompt, PII, and jailbreak attempts.

### 5. Outbound media: structured trigger + gate

Each of up to 5 send-media items (image/video) carries `{file, what-it-is, structured trigger + short nuance}`. The agent matches intent → media via the structured trigger, then a gate (already-sent? right moment?) runs before `send_media`. Not LLM-freeform.

### 6. Read scope + write-after-introspect

The agent reads Lead 360 + org knowledge (catalog via hybrid search, not stuffed) + on-demand read-tools. **Every write tool is preceded by an introspection read** that pulls the live system structure — `list_pipeline_stages`, `list_custom_fields`, `check_agenda_availability` — so actions target real, current entities. This eliminates the orphaned-stage/field bug class. Live ERP/stock and cross-company reads are deferred to v2.

### 7. Cumulative guardrails inside the loop

v1 ships five non-negotiable gates: **capability-gate** (block write if capability off), **tool-call budget** (max 5/turn), **wired loop-detector**, **output LLM-as-judge** (cheap second model vets the reply for unauthorized price/promise/leaked credential/tone before sending), **input short-circuit** (deterministic spam/abuse/competitor handling without spending LLM tokens). **HITL approval** is a per-org toggle (default off). **PII redaction** is deferred to v2. `transfer_to_human` fires a **structured handoff notification** (lead/tier/reason/summary/deeplink) to a configured number/owner.

### 8. Observability: hybrid

End-to-end `trace_id` across the turn + an eval dataset in Postgres now (satisfies decision #2). Langfuse self-hosted is adopted later, when scale justifies the infra.

### 9. Wizard ends in a dry-run simulator

The final wizard step is a live chat: the operator types as the lead, the agent responds with the real base prompt + filled config, and tools render as "would execute" (dry-run, zero real writes) with the trace shown. A button runs the archetype eval-suite (incident→regression cases) green/red.

### 10. Per-archetype model

A fast, tool-calling-strong model (Flash-class) for high-volume Qualificador and Carteira; a stronger model (Sonnet-class) for Vendedor's closing nuance. Tool-calling competence is the primary selection criterion.

### 11. Proactivity (outbound)

The agent initiates, not only replies: first-touch on ad leads (lead-webhook), scheduled follow-up on cold leads, and Carteira win-back of dormant clients. Cold mass-prospecting stays in the existing `campaigns` module — not duplicated. Requires a scheduler/trigger.

### 12. Separated asset stores, both org-level

Two distinct buckets, never conflated:
- **Send-media library** (image/video, ≤5) — sent raw to the lead via `send_media`, selected per archetype with per-archetype triggers.
- **Knowledge base** (image/video/doc/PDF) — ingested **media→text** (PDF/doc: extract+chunk; image: OCR/caption; video: transcript) → embed → retrieved via `search_knowledge`; never sent raw. Cognition stays text-only; true runtime multimodal is v2.

Both stores are org-level (shared by the three archetypes) to eliminate the per-agent duplication v1 suffered.

## Alternatives considered

- **Refactor v1 in place / engine behind a flag, reusing plumbing.** Rejected by the CTO in favor of a full clean-slate, accepting the cost in exchange for architectural purity — mitigated by decision #2 (incidents→regression tests).
- **Port hardened primitives instead of rewriting.** Recommended but rejected; the CTO chose full rewrite for total re-audit. Risk contained by the regression suite.
- **LLM judges the tier directly** (≈ v1). Rejected — non-deterministic, the source of current instability; guardrails web-clip warns against trusting the LLM for automated decisions.
- **Two archetypes only.** Initially locked, then reopened: post-sale (reorder/upsell/resgate) is a distinct motion that re-qualifying a known customer would botch. Third archetype added.
- **Multimodal-direct media embedding, send+knowledge merged** (the superseded `copilot-media-knowledge-base` spec). Rejected — conflates "send" with "know," and semantic-match send is less deterministic than structured triggers (decision #5/#12).
- **Langfuse from day one.** Deferred — in-house trace_id + eval dataset covers the regression need now without standing up infra prematurely.

## Consequences

**Positive**:
- One reusable base prompt per archetype serves ~30 orgs via config, not 30 bespoke prompts — the modular-monolith principle applied to prompts.
- Capability-gate + tool-call budget + wired loop-detector close confirmed instability holes.
- Write-after-introspect structurally kills the orphaned-stage/field bug class.
- Tracing + regression suite make the shared base prompt safe to evolve (no "cobertor curto" across tenants).
- Post-sale motion finally modeled (Carteira archetype).

**Negative**:
- Full rewrite of hardened primitives risks re-living solved incidents — gated by the regression suite, which is now a hard dependency, not optional.
- A scheduler/trigger subsystem must be (re)built for proactivity.
- Media→text ingestion adds OCR/transcription cost at upload time.
- Migration of ~30 live orgs requires each CTO to re-fill the new structured wizard.

**Risks**:
- If the incident→regression encoding (decision #2) is skipped or thin, the rewrite reintroduces production bugs the team already paid for.
- LLM-as-judge on every turn adds latency/cost — must be cheap-model and possibly sampled.
- Rollout discipline matters: Milennials-first (dogfood, validate traces/eval) → org-by-org → v1 stays until all migrated → decommission.

## Addendum (2026-05-29) — World-class scope pass

A second grill mined ~50 candidate additions from 6 angles (the 5 web-clips, best-in-class AI-SDR design, v1-recon gaps, B2B factory/distributor domain, leverage of existing modules, trust/safety). The following were pulled into **v1** on top of the 12 decisions above. They mostly extend a locked decision or reuse battle-tested v1 code; none contradicts the 12.

**Memory & context:** durable agent-curated **Lead Fact Memory** (`remember_lead_fact`, confidence+provenance+decay) distinct from ephemeral history and point-in-time Lead 360; conversation **auto-compaction with a pinned-facts floor**; always-on background **context extraction** (objections/intent/sentiment) feeding the rubric and the handoff; **multi-message debounce** (one LLM turn per burst).

**Delivery realism:** LLM-based **message split + typing indicator**, human-realistic **first-reply latency**, **duplicate-content guard**.

**Signals → action:** decaying, evidence-backed **Buying-Intent Signal** (distinct from the slow Qualification Tier) that fires handoff/notify/cadence; **frustration tripwire** → human; **engagement-adaptive follow-up cadence**.

**B2B commercial tools:** `build_quote` (**Cotação**: SKU lines + MOQ + deterministic quantity→price tiers), `get_reorder_forecast` (Carteira reorder timing/SKU), **spec Q&A with datasheet citation** (never fabricates a numeric spec → defers to human), `propose_payment_terms` (within client policy, out-of-policy → human).

**Trust/safety (the autonomous-agent-in-prod bar):** **grounded-claims gate** (every price/spec/prazo claim must trace to a retrieved source or be hedged; source chunk_id persisted); **confidence-based deferral** (per-turn self-assessment + client-set threshold → clarify or transfer); **action ledger + one-click undo** (before/after snapshots for reversible writes); **per-org cost/rate ceilings + graceful degradation**; **conversation/org kill-switch UX** (reason-coded banner over the phone-keyed pause); **brand-voice/commercial-policy linter** (compiles the tone+policy config into a hard pre-send gate); **adversarial red-team eval** (injection/exfil/jailbreak/over-promise) as a base-prompt release gate; **language/out-of-scope detection** → safe handoff.

**Observability/eval:** failure→dataset **regression loop enforced in CI**; per-turn **LLM-judge writing into the eval dataset** (keyed by trace_id); **reasoning-chain in the trace + dry-run simulator**.

**CRM integration (first-class citizen):** Copilot as a **bidirectional workflow node** (DAG invokes an archetype, gets a typed outcome back); **agent conversion-funnel analytics**; **Carteira health signals as proactive triggers**; **agent actions auto-logged on the shared ActivityTimeline**.

**Dropped decision — A/B prompt variants per agent.** The v1 `copilot_agent_variants` system is deliberately NOT carried. Rationale: it conflicts with the immutable Torque-owned base prompt (clients can't author variants), and ~30 orgs with low per-org volume cannot reach statistical significance — it would ship noise as signal. The eval dataset + LLM-judge + offline eval-suite comparison of base-prompt versions covers "is version B better?" at the dataset level. (Hard to reverse cleanly once built; surprising to a future reader; genuine trade-off — hence recorded here.)

**Deferred to v2/later:** RAG 3.0 subagent + Virtual File System for huge catalogs; corrective RAG; cross-sell from order history; CEP/freight delivery estimate; stock/availability; fiscal/CNPJ capture + enrichment; RFQ parsing (photo/PDF→SKU); buying-committee mapping; meeting no-show recovery; gated ElevenLabs voice notes; outbound-scoped humanizer; closed-loop prompt self-improvement (suggest→A/B via split_ab→promote); objection/lost-reason intelligence loop; in-conversation campaign enrollment; agent-assists-rep gamification; manager conversation-quality scorecard; unified agent inbox/daily queue; LGPD retention/erasure posture; live agent-uncertainty surfacing + drift alerting.
