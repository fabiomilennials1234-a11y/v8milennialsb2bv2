# Tech Stack

**Analyzed:** 2026-04-01

## Core
- Framework: React SPA (Single Page Application)
- Language: TypeScript ^5.8.3 (strict mode, ES2020 target)
- Runtime: Node 20 (Dockerfile `node:20-alpine`; Deno for Supabase Edge Functions)
- Package manager: npm (package-lock.json)
- Build tool: Vite ^5.4.19 (SWC transform via `@vitejs/plugin-react-swc` ^3.11.0, esbuild minification)

## Frontend
- UI Framework: React ^18.3.1 + React DOM ^18.3.1
- Styling: Tailwind CSS ^3.4.17 (dark mode via class strategy, HSL CSS custom properties, PostCSS + Autoprefixer ^10.4.21, `tailwindcss-animate` ^1.0.7, `tailwind-merge` ^2.6.0)
- State Management: TanStack React Query ^5.83.0 (server state); Supabase Realtime subscriptions (live data)
- Form Handling: React Hook Form ^7.61.1 + `@hookform/resolvers` ^3.10.0 + Zod ^3.25.76 (schema validation)
- Routing: React Router DOM ^6.30.1 (BrowserRouter)
- UI Components: shadcn/ui (Radix UI primitives + CVA ^0.7.1 + clsx ^2.1.1), cmdk ^1.1.1 (command palette), Vaul ^0.9.9 (drawer), Sonner ^1.7.4 (toasts), Lucide React ^0.462.0 (icons), react-resizable-panels ^2.1.9
- Charts: Recharts ^2.15.4
- Animation: Framer Motion ^12.24.7
- Drag & Drop: @dnd-kit/core ^6.3.1 + @dnd-kit/sortable ^10.0.0
- Flow/Node Editor: @xyflow/react ^12.10.1 (workflow visual builder)
- Calendar: react-big-calendar ^1.15.0 + react-day-picker ^8.10.1
- Date Utilities: date-fns ^3.6.0
- Markdown: react-markdown ^10.1.0 + remark-gfm ^4.0.1
- Spreadsheet: xlsx ^0.18.5 + PapaParse ^5.5.3 (CSV import/export)
- Audio: lamejs ^1.2.1 (MP3 encoding)
- Theming: next-themes ^0.3.0 (dark/light toggle)
- OTP Input: input-otp ^1.4.2

## Backend
- BaaS: Supabase (project `jsjsmuncfkbsbzqzqhfq`; client `@supabase/supabase-js` ^2.89.0)
- Database: PostgreSQL via Supabase (292 migrations, RLS enforced, `pg_cron`/`pg_net` for scheduled jobs)
- Authentication: Supabase Auth (email without confirmation for internal users)
- API Style: Supabase client SDK (PostgREST auto-generated) + 76 Deno Edge Functions (`supabase/functions/`)
- Realtime: Supabase Realtime channels (WebSocket subscriptions for live updates)
- Storage: Supabase Storage (media streaming via `stream-media` Edge Function)

## Testing
- Unit: Vitest ^4.1.0 (jsdom environment, 8 test files in `tests/unit/`)
- Integration: Vitest ^4.1.0 (6 test files in `tests/integration/`, Supabase client against live DB via `pg` ^8.13.1)
- E2E: Playwright ^1.58.2 (Chromium, 5 spec files in `tests/e2e/`, html reporter)
- Coverage: @vitest/coverage-v8 ^4.1.0 (v8 provider; text + html + lcov reporters)
- Test Utils: @testing-library/react ^16.3.2, @testing-library/jest-dom ^6.9.1, @testing-library/user-event ^14.6.1

## External Services
- Error Monitoring: Sentry (@sentry/react ^10.43.0 + @sentry/vite-plugin ^5.1.1; browser tracing + session replay)
- AI/LLM: OpenRouter API (used in Edge Functions for lead scoring, conversation summarization, FAQ generation, agent conversation evaluation, custom instructions)
- WhatsApp (Evolution API): Evolution API (message sending/receiving, webhook processing via `evolution-webhook` Edge Function)
- WhatsApp (SZChat/Fortics): SZChat API (webhook + send via `sz-chat-webhook`/`sz-chat-send` Edge Functions)
- WhatsApp (Meta): Meta WhatsApp Business API (message sending, webhook, OAuth, lead forms via `meta-webhook`/`send-meta-message`/`meta-oauth-callback` Edge Functions)
- Meta Ads: Meta Marketing API (ads insights via `meta-ads-insights` Edge Function)
- ERP: TinyERP (product sync, order push, NF-e fetch, webhook via 8 `tinyerp-*` Edge Functions)
- Calendar: Google Calendar API (OAuth connect, events, sharing, webhook via 6 `google-calendar-*` Edge Functions)
- Calendar (external): Cal.com (webhook via `webhook-calcom` Edge Function)
- Payments: Asaas (payment creation, webhook processing, org provisioning via `checkout-*` and `asaas-webhook` Edge Functions)
- Text-to-Speech: ElevenLabs (audio generation via `elevenlabs-proxy` Edge Function)
- Embeddings: Supabase + OpenRouter (FAQ embeddings via `generate-faq-embeddings` Edge Function)

## Infrastructure
- Hosting: Hostinger VPS (Docker Compose)
- Container: Multi-stage Docker (Node 20 Alpine build + Nginx Alpine serve)
- Web Server: Nginx (SPA routing, security headers: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy)
- Production Domain: torquecrm.com.br

## Development Tools
- Linting: ESLint ^9.32.0 (flat config, typescript-eslint ^8.38.0, react-hooks, react-refresh plugins)
- TypeScript: Strict mode (`strict`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `strictNullChecks`)
- Path Aliases: `@/` mapped to `./src/` (Vite + TSConfig)
- Dev Server: Vite dev server (localhost:8080, proxy `/api/calendar-service` to `:8000`)
- Code Splitting: Manual Rollup chunks (vendor, supabase, charts, motion, query, dnd)
- Tagging: lovable-tagger ^1.1.13 (component tagger in dev mode)
- Environment: `.env` / `.env.development` / `.env.local` layered config (Vite standard)
