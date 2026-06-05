# 3. Mass Send daily budget and auto-batched Blast Plans

Date: 2026-06-05

## Status

Accepted

## Context

ADR-0002 framed the Quick Blast safety guardrail as a **per-blast** ceiling on leads (default 200). We are now adding **auto-batching**: a Mass Send whose audience is larger than one day can hold is spread over consecutive days (a **Blast Plan**), so a salesperson can target "everyone in this Stage" and let it drain on its own.

A per-blast ceiling is the wrong control for that. Two manual blasts plus a plan lot in the same day each pass the per-blast check yet sum well past a safe daily volume — exactly the repeated-traffic pattern that gets a WhatsApp number banned.

Auto-batching also forces a second decision: when a later lot fires tomorrow, does it re-query the source Stage (picking up Leads that arrived since) or send to a frozen list captured at creation? Re-querying turns the feature into a standing daily rule that never terminates while Leads keep entering the Stage — which is a Workflow, the very thing this feature exists to avoid.

## Decision

1. **Daily Blast Budget replaces the per-blast cap framing.** The guardrail is an Organization-wide ceiling on how many Leads may be messaged via Mass Send per calendar day (default 200), **summed across every blast** — manual Quick Blasts and Blast Plan lots alike. Enforced server-side, **fail-closed** (missing/invalid config → default ceiling, never unlimited).

2. **Blast Plan = frozen snapshot, sliced into daily lots.** When an audience exceeds the remaining daily budget, the Leads are sliced into daily lots over consecutive days. Membership is **frozen at creation** — Leads that enter the source Stage afterward are not added.

3. **Each lot re-applies refinements at release and consumes only remaining budget.** A daily release job re-applies the audience refinements (reply status, contact recency) at send time and dispatches at most the day's remaining Daily Blast Budget. A lot that cannot fully fit defers its remainder to the next day; a Plan's duration is therefore elastic, not fixed.

4. **Frozen-not-requery is deliberate.** It keeps a Blast Plan a finite, self-terminating broadcast rather than a standing Stage rule. A standing rule belongs to the Workflow engine, which this feature explicitly stays out of.

## Consequences

- The Daily Blast Budget is now the security-critical control (it was the per-blast cap). It must be server-side and fail-closed; lowering it remains the cheapest lever if abuse appears.
- A Blast Plan introduces frozen-membership storage plus a cron releaser. A future reader sees Mass Send spawning recurring scheduled jobs — this ADR is why, and why it is **not** a re-querying rule.
- Manual Quick Blasts and Plan lots share one budget ledger; a heavy manual day can delay a Plan's lots. Accepted — protecting the number outranks plan punctuality.
- This **supersedes the "leads-per-blast" cap framing of ADR-0002**. ADR-0002's other decisions — no role gate for Quick Blast, RLS org-scoping, per-recipient personalization, randomized delay — stand unchanged.
