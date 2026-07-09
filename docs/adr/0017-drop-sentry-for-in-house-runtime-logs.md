# 17. Drop Sentry; observability is in-house (`runtime_logs` + client error buffer)

Date: 2026-07-09

## Status

Accepted

## Context

Sentry has been wired into this codebase from early on and is, on paper, the observability story: `Sentry.init` with Session Replay in `src/main.tsx`, `@sentry/react` + `@sentry/vite-plugin` in the bundle, `VITE_SENTRY_DSN` threaded through the `Dockerfile` and the GitHub Actions image build, and `withSentry()` wrapping all ~78 edge functions as the documented handler pattern.

In practice nobody reads the dashboard and the DSN is not maintained. When the DSN is absent, `Sentry.init` is a silent no-op and `withSentry` degrades to `console.error` — so the SDK ships in every user's bundle and every edge function carries a wrapper, all of it doing nothing. Meanwhile the team has been independently building the thing Sentry was supposed to be: `runtime_logs`, a structured, org-scoped, RLS-protected log table in our own Postgres, plus an observability console prototype in the Master area.

This came to a head while designing the **Chamado** (support ticket) feature, which needs technical evidence attached to each ticket. The obvious design — attach Sentry's `event_id` and `replay_id` — would have built a user-facing feature on top of dormant infrastructure.

Two further facts pushed the decision:

- **Session Replay was never going to carry its weight here.** A CRM screen is full of our customers' customers' PII — names, phones, CNPJs. Replay runs (correctly) with `maskAllText: true`, and any move to unmask it in order to make replays useful would ship lead PII to a US-hosted third party. The privacy-safe configuration is also the low-value one.
- **Sentry would not have covered the majority of failures anyway.** Most frontend actions go straight to PostgREST via `supabase-js` and never touch an edge function. RLS denials, constraint violations, and 400s are invisible to any backend-side APM.

## Decision

1. **Remove Sentry entirely** — the `@sentry/react` and `@sentry/vite-plugin` dependencies, `Sentry.init`, `VITE_SENTRY_DSN` in the `Dockerfile` and CI, and the references in `CLAUDE.md` / `AGENTS.md` / `.specs`.

   **`withSentry()` is replaced, not deleted.** Despite its name it is not a reporting wrapper: it is the top-level error boundary of all ~109 edge functions that import it. It catches the unhandled exception, logs it, reports to Sentry, *and returns a 500 carrying the CORS headers*. Delete it and an unhandled exception returns a response with no CORS headers — the caller's browser reports a CORS failure instead of a server error, and the real error is invisible. It becomes `withErrorBoundary(functionName, handler)` in `_shared/error-boundary.ts`, behaviourally identical minus the Sentry envelope. `captureError` / `captureMessage` have three call sites and collapse into structured console logging.

2. **`runtime_logs` is the single backend observability surface.** Edge functions log there; RLS keeps it master-only.

3. **A client-side error ring buffer covers the frontend.** An in-memory buffer of the last N `window.onerror`, `unhandledrejection`, and failed `supabase` calls, held in the browser and flushed into a Chamado's Support Context at open time. It is not a table and not a stream — it exists only to be attached to a Chamado.

4. **Correlation is by `session_id`, not by a vendor trace.** The client mints a `session_id` per browsing session and sends it as a header on every call the Supabase client makes; `runtime_logs` stores it alongside a per-call `request_id`. Given a Chamado, staff query `runtime_logs` by `session_id` to reconstruct the timeline of backend work during that session.

   It is `request_id`, not `trace_id`, because `trace_id` already means something else here — a Copilot v2 agent turn, persisted to `copilot_v2_trace_steps`. Two identifiers of the same name at different granularities would mislead every future reader, human or model.

5. **Retention makes or breaks the above, and is therefore part of the decision.** A correlation id is worthless if the rows it points at are gone. Production was running three contradictory policies on `runtime_logs` — a job named `cleanup_runtime_logs_90d` that actually deleted at 14 days, and a `purge-runtime-logs-2d` that deleted at 2 and won. The table held two days. A Chamado opened on a Friday and triaged on a Monday would have found nothing.

   Retention is now per-module: `webhook` keeps 2 days, everything else keeps 30. `webhook` is 98% of the volume (~105k rows/day against ~2k for every other module combined) and its diagnostic value decays in hours; a Chamado's does not.

6. **Phone numbers in `runtime_logs` are masked, not redacted.** A phone in a log payload is PII belonging to *our customer's lead*, not to our customer. Full redaction would make it impossible to tie a log line to a conversation; clear text is unacceptable. The middle is masked (`5511*****2210`), preserving a JID's suffix. Credential keys still redact entirely.

## Consequences

- **We lose Session Replay.** Nothing reproduces "watch the user click." The compensations are the client error buffer, the `session_id` timeline, and an optional user-attached screenshot. This is accepted: the privacy-safe replay was already close to worthless for our screens. Note that the `session_id` timeline only compensates for as long as the rows survive — see decision 5. Shortening `runtime_logs` retention silently removes the compensation.
- **We lose managed alerting, grouping, and release health.** These must be rebuilt on `runtime_logs` if and when they are wanted. Nothing is lost today because nothing was being read today.
- **A `module` typo is now a build error, not a lost row.** The `CHECK` on `runtime_logs.module` allowed 10 values while the code wrote 25, and `logRuntime` swallows a failed INSERT by design — so 15 modules believed they were logging and never wrote a line. The constraint was dropped and the vocabulary moved to the `RuntimeLogModule` union type. That guard only bites if the type checker runs, and today edge functions are tested with `deno test --no-check`; tracked separately.

- **Both observability halves become load-bearing.** `runtime_logs` covers edge functions; the client buffer covers PostgREST/RLS/render failures. Neither is redundant with the other, and neither alone is sufficient.
- **Customer telemetry stops leaving our infrastructure.** All error evidence now lives in the same Postgres, under the same RLS, as the data it describes — which materially simplifies the data-processing story with B2B customers.
