# Project: Torque CRM

**Created:** 2026-04-01
**Owner:** V8 Millennials

## Vision

Torque CRM is a multi-tenant B2B SaaS CRM built for Brazilian sales teams. It combines pipeline management, WhatsApp-native communication (Evolution API, SZChat, Meta Business), AI-powered sales copilots, workflow automation, and analytics into a single platform.

The product targets small-to-medium sales organizations that rely heavily on WhatsApp as their primary sales channel. It differentiates through deep WhatsApp integration, AI copilot agents that autonomously handle conversations, and visual workflow automation.

## Goals

1. **WhatsApp-first CRM** -- Every interaction flows through WhatsApp. The CRM is the system of record for conversations, leads, and pipeline progression.
2. **AI-augmented selling** -- Copilot agents handle initial conversations, qualify leads, schedule follow-ups, and generate insights. Humans close deals.
3. **Self-service multi-tenancy** -- Organizations sign up via checkout, provision automatically, and are fully isolated via RLS and org-scoped hooks.
4. **Workflow automation** -- Visual workflow builder enables non-technical users to create trigger-based automations (lead events, cron, tags, scores).
5. **Operational intelligence** -- Dashboards, analytics, gamification, and the "Oraculo Comercial" AI provide real-time visibility into sales performance.

## Product Boundaries

**In scope:**
- Lead management with custom fields, scoring, tagging
- Multi-stage sales pipelines (WhatsApp, Confirmacao, Propostas, Follow-ups, Custom)
- WhatsApp messaging via 3 providers (Evolution API, SZChat, Meta)
- AI copilot agents with TTS, document RAG, and conversation evaluation
- Workflow automation with visual editor
- Campaign management (manual, semi-auto, auto dispatch)
- Google Calendar integration
- TinyERP integration (product sync, order push, NF-e)
- Checkout/subscription via Asaas (PIX + credit card)
- Master admin panel for multi-org management

**Out of scope (current):**
- Mobile native app
- Email marketing
- Phone/VoIP integration
- Self-hosted deployment (currently Hostinger VPS only)

## Technical Profile

- **Frontend:** React 18 SPA + TypeScript + Vite + Tailwind + shadcn/ui
- **Backend:** Supabase (PostgreSQL + Auth + 80+ Edge Functions + Realtime + Storage)
- **AI:** OpenRouter (multi-model gateway) + OpenAI Embeddings
- **Hosting:** Hostinger VPS (Docker + Nginx)
- **Domain:** torquecrm.com.br

See `.specs/codebase/` for detailed technical documentation.
