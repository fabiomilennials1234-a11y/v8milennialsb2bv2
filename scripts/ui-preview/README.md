# ui-preview — the real app, logged in, on fake data

Runs the **real** Torque app (`src/`, real routes, real components) against a
**local fake Supabase** that serves a coherent fixture tenant. It is built for
visual QA: take screenshots of every screen before and after a change and
compare them.

It never talks to a real Supabase project. The mock listens on `127.0.0.1`
only. The Vite launcher refuses any `VITE_SUPABASE_URL` that is not loopback,
and it injects its env on the process, so a stray `.env.local` aimed at prod
cannot take over. Writes made in the UI only change mock memory. Nothing here
needs Docker or adds npm dependencies.

## Quick start (3 terminals, from the repo root)

```bash
# 1. fake Supabase on http://127.0.0.1:54399
node scripts/ui-preview/mock-supabase.mjs            # add --master for a master session

# 2. the app on http://localhost:4180 (vite --mode uipreview, HMR off)
node scripts/ui-preview/start-vite.mjs

# 3. screenshots: every route × dark/light × 1440/390
node scripts/ui-preview/shoot.mjs before             # → /tmp/ui-preview-shots/before/
#    …apply the restyle…
node scripts/ui-preview/shoot.mjs after              # → /tmp/ui-preview-shots/after/
```

Output: `<out>/<theme>-<width>/<route>.png`, plus `<out>/report.json`. The
report has one entry per shot with:
- the final URL (redirects show up)
- error-boundary, login, env-missing and feature-lock detection
- console errors and page errors
- failed requests
- **mock misses**: tables and RPCs the screen asked for that the fixtures do not cover

Each shot takes 3 to 4 seconds, so a full run (50 routes × 4 variants) takes about 12 minutes. A route that throws is recorded as `error` in the report and the run goes on. If the mock or the app stops answering, the run stops, after first writing the partial report. `/tmp` can be cleaned between sessions, so copy shots elsewhere (`--out`) if you need to keep them.

### `shoot.mjs` options

| flag | meaning |
|---|---|
| `[label]` | output folder name (default: timestamp) |
| `--out <dir>` | output root (default `/tmp/ui-preview-shots/<label>`) |
| `--routes dashboard,leads,funil-vendas` | only these route names (see `routes.mjs`) |
| `--themes dark,light` | default: both |
| `--widths 1440,390` | default: both. 1440×900 desktop; 390×844 is phone (isMobile + touch) |
| `--full-page` | capture the whole document height |
| `--master` | include `/master/*` and `/insights` (start the mock with `--master`) |
| `--direct` | load each route by URL and wait out the 3.3 s intro animation (see below) |
| `--real-clock` | do not shift the browser `Date` to the fixture clock |

Example of a fast iteration on one screen:

```bash
node scripts/ui-preview/shoot.mjs wip --routes funil-vendas --themes dark --widths 1440
```

### Opening the app by hand

Start terminals 1 and 2, then open a browser with the session injected. A
plain browser tab lands on `/auth`, because there is no session in its
localStorage. The quickest route is a Playwright REPL:

```js
// node --input-type=module
import { launchBrowser, prepareContext } from "./scripts/ui-preview/browser-session.mjs";
const b = await launchBrowser({ headless: false });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await prepareContext(ctx, { theme: "dark" });
const p = await ctx.newPage();
await p.goto("http://localhost:4180/dashboard");
```

## How it works

| piece | file | what it does |
|---|---|---|
| Vite launcher | `start-vite.mjs`, `vite.config.mjs` | `npx vite --config scripts/ui-preview/vite.config.mjs --mode uipreview --port 4180`. The config is the app's own `vite.config.ts` with `server.hmr: false`: other agents edit `src/` while shots run, and HMR reloads were producing black or white frames. Every page load still gets the latest source. `UI_PREVIEW_HMR=1` turns HMR back on. The CSP plugin in `vite.config.ts` already adds `http://127.0.0.1:54399` and `ws://` to `connect-src`. |
| Fake Supabase | `mock-supabase.mjs` | `node:http`, no dependencies. See the next section. |
| Schema | `lib/schema.mjs` | Parses `src/integrations/supabase/types.ts` (read-only) into columns, foreign keys, enums and RPC return types. Fixture rows are padded with every real column. Embeds resolve through the real FK graph. An unknown RPC answers with the right shape: `[]` for set-returning, `null` for Json, `true` for `is_*`/`can_*`/`has_*`. |
| PostgREST | `lib/postgrest.mjs` | `select=` with embeds (`alias:rel!hint(cols)`, `!inner`, spreads, `count`) and filters (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`, `cs`, `cd`, `ov`, `not.*`, `or=`/`and=` trees). Also `order`, `limit`, `offset`, `Prefer: count=exact` (Content-Range) and `.single()` (406 PGRST116 on 0 rows, as prod does). Anything it does not understand is ignored rather than failing. |
| Realtime | `lib/realtime.mjs` | A hand-rolled WebSocket speaking Phoenix vsn 1.0.0. It acks every `phx_join`, echoing the postgres_changes bindings so channels report SUBSCRIBED, and it answers heartbeats. It never pushes events. |
| Session | `lib/session.mjs`, `browser-session.mjs` | Fake JWT (`sub` = fixture user, `aal2`, expiry 5 years out) and the anon key. `prepareContext()` writes localStorage before boot. |
| Fixtures | `fixtures/seed.mjs` | The tenant (below). Deterministic, seeded PRNG. |
| RPCs | `fixtures/rpc*.mjs` | Funnel board, chat inbox and thread, dashboard, metrics, performance, carteira. |
| Edge functions | `fixtures/functions.mjs` | `get-member-permissions` (all granted), `whatsapp-api-proxy` (`{ok,result}` envelope), `oraculo-briefing`, `get-daily-priorities`. Anything else gets `{}`. |

**`mock-supabase.mjs` routes:**
- `/auth/v1/*`: user, token, logout, settings
- `/rest/v1/<table>`: PostgREST emulation over the fixtures. GET, HEAD, POST, PATCH and DELETE work; writes change memory only.
- `/rest/v1/rpc/<fn>`: the RPC fixtures
- `/functions/v1/<fn>`: the edge-function fixtures
- `/storage/v1/*`: empty answers
- `/realtime/v1/websocket`: the realtime socket above
- introspection: `/__health`, `/__log?since=<ms>`, `/__misses`, `/__reset` (reload the seed)

**Session storage key:** supabase-js keys it as
`` `sb-${new URL(url).hostname.split(".")[0]}-auth-token` `` (in
`node_modules/@supabase/supabase-js/dist/index.mjs`). For `http://127.0.0.1:54399`
that gives **`sb-127-auth-token`**.

**Other localStorage keys set by `prepareContext`:**
- `v8-theme` (the next-themes `storageKey` in `App.tsx`) and `torque-theme`, set to `"light"` or `"dark"`
- `selected_org_id`
- the "already seen" flags for the support-launch modal and its nudge, so no first-run overlay covers the shots

**Boot without the intro.** `TorqueIntro` plays a 3.3 s logo animation on every full load of a non-public path. It skips public paths and only decides on mount. So `shoot.mjs` boots each route fresh on `/privacidade` and then client-navigates (`history.pushState` + `popstate`) to the target. Each route still gets a fresh app, with no state, blocker or error boundary leaking between routes, and no intro. `--direct` loads the URL itself and waits the intro out instead.

**The clock.** Fixtures are pinned to `2026-09-17T14:30-03:00`, mid-month, so "este mês" widgets have data. `shoot.mjs` shifts only the browser's `Date` to that instant, and time keeps flowing from there. Relative dates ("há 2 h", "17 SET") are therefore identical on every run, which keeps before/after diffs clean.

Playwright's `context.clock` is deliberately not used. It also fakes rAF, `performance` and timers, and that stalled framer-motion: the kanban rendered blank or black.

To use real time instead:
- `UI_PREVIEW_NOW=now node scripts/ui-preview/mock-supabase.mjs` makes the fixtures relative to the real now
- `--real-clock` on `shoot.mjs` leaves the browser on the real clock

## The fixture tenant

- **Org:** "Milennials" (`0a000000-0000-4000-8000-000000000001`, deliberately not the real org id), plan "enterprise". Every sellable feature is on. The behaviour toggles `white_label`, `merged_opportunity_funnel`, `unified_message_gateway` and `user_write_instance_strict` are off.
- **User:** Gabriel Gipp, `admin`, CEO & Head Comercial. `--master` adds a `master_users` row (full permissions, `aal2`), which unlocks `/master` and `/insights`.
- **Team:** 9 members: 2 admins, closers, SDRs, a BDR and Customer Success.
- **Funnels:**
  - Funil de Vendas (`vendas`, default): Novo → Em conversa → Reunião marcada → Reunião realizada → Proposta enviada → Ganhou / Perdeu
  - Prospecção Outbound (`prospeccao`)
  - Recompra & Upsell (`recompra`)
  - Indicações (`indicacoes`)
- **Leads and deals:** 27 leads from Brazilian B2B industry (invented names, CNPJs and phones), with tags, deals and cards spread across the stages.
- **WhatsApp:** 2 connected instances, 8 threads (25 messages; the copilot-sent ones are labelled), and 5 Copilot conversations, one of them waiting on a human.
- **Copilot and automations:** 4 agents (one inactive) and 5 workflows.
- **Catalogue and carteira:** 6 products; 10 carteira clients with 30 orders, health scores and reorder cycles.
- **Engagement:** follow-ups, activities, today's actions, goals (org and individual), commissions, an active competition with prizes, awards, message templates, notifications and lead history.
- **Métricas:** the 4 template panels (`metrics_studio_panels`) read from `src/modules/analytics/lib/metrics-studio-templates.json`.

## Coverage (verified with Playwright, 2026-10-02)

Last check: `shoot.mjs verify` covered dashboard, leads, funil-vendas, chat-whatsapp (inbox and open thread), copilot, equipe and upsell in all 4 variants. That is 32 shots with no error boundary, no page error and no blank frame. The only console error was the expected `master_users` 406. The other routes below come from the full dark-1440 sweep.

**Render with data**, 4 variants each:
- `/dashboard` (Comando), `/leads`, `/funil/vendas` (plus `prospeccao` and `recompra`), `/chat-whatsapp`, and `/chat-whatsapp?instance=…&phone=…` (thread and lead panel open)
- `/copilot`, `/copilot/novo`, `/copilot/:id/editar`
- `/metricas`, `/performance` (ranking + competition), `/funis`, `/agenda`, `/follow-ups`, `/upsell`, `/carteira/:id`
- `/automacoes`, `/automacoes/:id` (editor), `/automacoes/novo`
- `/produtos`, `/templates`, `/comissoes`, `/equipe`, `/faq`, every `/configuracoes` tab
- `/master`, `/master/organizations` and `/insights` with `--master`

**Render, but in their empty state** (no fixture yet; the report lists the tables and RPCs they ask for):
- `/lixeira` (`get_trash_leads`), `/duplicatas` (`find_duplicate_leads`)
- `/oraculo` (`oraculo_conversations`), `/copilot/metricas` (evaluations and variants)
- `/automacoes/:id/execucoes` (`get_workflow_execution_history`)
- `/disparos` (`blast_plans`), `/checklists` (`checklists`), `/atendimento/meta` (no Meta page connected)
- **`/tv` renders black.** The TV wall needs `dashboards` / `dashboard_pages` / `dashboard_widgets`, which are not seeded.

**Known console noise** (also happens in prod):
- one `406` on `master_users` for a non-master: this is how `useMasterAuth` learns "not a master"
- `X-Frame-Options`/`frame-ancestors` warnings from the `<meta>` CSP. `shoot.mjs` filters these.

## Extending

1. Run the shot, open `report.json`, and look at `mockMisses` for the route.
2. Table → add rows in `fixtures/seed.mjs` (under `db`). Only set what the screen reads; missing real columns are padded from `types.ts`.
3. RPC → add a handler in `fixtures/rpc*.mjs`: `(args, fx) => result`. Get the response type from the hook that calls it. Edge function → `fixtures/functions.mjs`.
4. Restart the mock: fixture modules are loaded once per process.
   `GET /__reset` only restores the seed after the UI wrote to memory, and `shoot.mjs` calls it before each theme/width pass.

## Troubleshooting

- **Login screen in shots:** the mock was not running when the page booted, or the session key changed. The key is derived from the mock URL; check `STORAGE_KEY` in `lib/session.mjs`.
- **`EnvMissingScreen`:** Vite was not started through `start-vite.mjs`.
- **Black/white frames:** HMR was re-enabled (`UI_PREVIEW_HMR=1`) while `src/` was changing. Restart `start-vite.mjs` without it.
- **Playwright's pinned Chromium is not installed:** `launchBrowser()` falls back, in order, to any `~/Library/Caches/ms-playwright/chromium*` and then to system Chrome (`channel: "chrome"`). `UI_PREVIEW_CHROME=/path/to/chrome` forces one.
- **Ports:** `UI_PREVIEW_MOCK_PORT` (54399) and `UI_PREVIEW_APP_PORT` (4180). Set the same values for all three commands.
