# 18. Chamado — an in-house support desk, not a bought widget

Date: 2026-07-09

## Status

Accepted

Depends on ADR-0017 (Sentry is removed; observability is `runtime_logs` + a client-side error buffer).

## Context

Torque had no way for a customer to report a bug or reach support from inside the product. There was a Help Center (`help_articles`), but it was read-only and buried in a tab of `/configuracoes` — a deflection layer with nothing behind it and nobody finding it.

Every comparable product solves this with a bought widget (Intercom, Crisp, Zendesk, Plain, Pylon), and at ~30 tenants those cost between nothing and a few hundred a month. The reason we are not buying one is that the three expensive parts of a support desk already exist here: a Master console for cross-org staff work, RLS multi-tenancy as the load-bearing security primitive, and WhatsApp delivery via Uazapi. What a widget would sell us is an inbox, a staff console, and an email loop — and the email loop is the only one we don't already have.

Buying also means our customers' customers' data — lead names, phones, CNPJs, visible in any screenshot — leaves our Postgres for a third party's. For a B2B product whose tenants are Brazilian factories and distributors, that is a data-processing conversation we would rather not have for a feature this small.

## Decision

1. **One entity, `support_tickets` (domain: *Chamado*), with a mutable `tipo`** (`bug` / `duvida` / `solicitacao`). Type is the *output* of triage, not an input: the most common path is a "bug" that turns out to be a misconfiguration, or a "question" that turns out to be a defect. Separate tables for bugs and questions would force a migration on the most frequent transition, destroying the thread and its id. Threading lives in `support_ticket_comments`, carrying `is_internal` for staff-only notes.

2. **A Chamado belongs to the Organization and is authored by a User.** Any authenticated user may open one — whoever sees the bug is whoever uses the screen. RLS grants: author reads their own; org admin reads all of the org's (so a departed employee's Chamado survives them, and duplicates within an org are visible); master reads everything and is the only role that may read internal comments. Policies must use `get_my_organization_ids()` / `get_my_admin_organization_ids()`, never an inline `SELECT ... FROM team_members` — see the Realtime/`apply_rls()` recursion rule.

3. **The user states Impacto; staff derives Severidade.** A user genuinely knows whether they are blocked; they cannot know whether a defect is critical, because criticality depends on how many *other* tenants are hit. Asking users for severity yields a queue in which everything is critical.

4. **Cross-tenant defects are tracked in GitHub Issues, not in Postgres.** Each Chamado carries a `defect_url`. Counting Chamados grouped by that URL is what makes Severidade a measurement rather than a guess, and lets staff resolve N tenants' Chamados when one issue closes. A `Defeito` table would be a second source of truth about a bug that already has an owner, a label, and a linked PR somewhere else.

5. **Deflection is article search, no AI.** The Help Center moves out of the `/configuracoes` tab into the support panel, with articles suggested by current route. At ~30 tenants an LLM deflection layer costs more trust than it saves hours.

6. **The entry point is a unified dock, not a fourth floating bubble.** `ChatBubbleFab`, `OraculoFloatingButton`, and `QuickBlastProgressPanel` all already render at `fixed bottom-6 right-6`, stacking and occluding each other. Support joins them behind one expandable dock, which resolves the existing collision rather than adding to it.

7. **Notification is asymmetric.** Torque staff are alerted by WhatsApp to a dedicated support group, from a platform-owned Uazapi instance (never the Milennials sales number) — configured as `SUPPORT_UAZAPI_INSTANCE_ID` + `SUPPORT_WHATSAPP_GROUP_JID`, not as a table of phone numbers that rots as people join and leave. The customer is notified **in-app** (the existing `notifications` table + a badge on the dock), because unlike Vercel's or Stripe's users, ours are sales teams living inside the CRM all day. A WhatsApp ping to the customer is a *fallback* only, and only when staff has replied, the author has not read it in 24h, and a phone number exists.

8. **Owner by claim, target by policy.** `assigned_master_user_id` records who *took* a Chamado, not who was assigned it — there is no dispatcher on a three-person team. First-response targets are a constant per Severidade, not a deadline column: a deadline stamped on every row means changing the policy either rewrites history or leaves two policies in force. What is stored are facts — `first_response_at`, `resolved_at`, and accumulated time in `aguardando_cliente`, which is subtracted so a silent customer never counts against staff.

9. **Attachments are private.** A screenshot of a CRM screen contains the tenant's leads' PII. `support-attachments` is a private bucket read through short-lived signed URLs, authorized server-side. The public `help-media` bucket must not be reused for this.

## Consequences

- **We own the inbox, the notification loop, and spam.** These are real costs a widget would have absorbed.
- **There is no email in or out.** This is fine while customers are daily-active in the product and staff live in WhatsApp; it becomes the binding constraint the day either stops being true. That day, an inbound-email-to-thread parser is the piece to build — not a widget.
- **`defect_url` is a string, deliberately.** When volume justifies a `Defeito` entity with fan-out notification (Linear's Customer Request model), that column is where the foreign key goes. Nothing about this decision blocks it.
- **`assignee` and first-response tracking exist from v1** despite a three-person team, because three is already enough for two people to answer the same customer.
- **Deferred on purpose, each a single migration when needed**: `priority` as an axis separate from Severidade (rejected — two urgency axes means none), per-severity notification routing (`support_notification_targets`), contractual SLA, AI deflection.
