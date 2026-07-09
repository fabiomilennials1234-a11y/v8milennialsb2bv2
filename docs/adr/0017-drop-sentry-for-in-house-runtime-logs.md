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

4. **Correlation is by `session_id`, not by a vendor trace.** The client mints a `session_id` per browsing session and sends it as a header on every edge-function call; `runtime_logs` stores it alongside a per-call `trace_id`. Given a Chamado, staff query `runtime_logs` by `session_id` to reconstruct the timeline of backend work during that session.

## Consequences

- **We lose Session Replay.** Nothing reproduces "watch the user click." The compensations are the client error buffer, the `session_id` timeline, and an optional user-attached screenshot. This is accepted: the privacy-safe replay was already close to worthless for our screens.
- **We lose managed alerting, grouping, and release health.** These must be rebuilt on `runtime_logs` if and when they are wanted. Nothing is lost today because nothing was being read today.
- **Both observability halves become load-bearing.** `runtime_logs` covers edge functions; the client buffer covers PostgREST/RLS/render failures. Neither is redundant with the other, and neither alone is sufficient.
- **Customer telemetry stops leaving our infrastructure.** All error evidence now lives in the same Postgres, under the same RLS, as the data it describes — which materially simplifies the data-processing story with B2B customers.
