# 21. Support realtime: postgres_changes, after Broadcast proved impossible on this project

Date: 2026-07-17

## Status

Accepted

Depends on ADR-0018 (the Chamado support desk: `support_tickets` + `support_ticket_comments`, RLS visibility, asymmetric notification).

## Context

The support desk shipped without realtime. A customer opens a Chamado and follows the thread; a master answers from the Master console — and neither side sees the other's message until an F5, a thread reopen, or a window refocus. The queue is worse: `useMasterSupportTickets` is a plain `useQuery` with `staleTime: 30s` and no `refetchInterval`, so a new Chamado does not enter the master's screen on its own. The one piece of realtime in the whole feature is the customer's unread badge, which subscribes to `notifications`, not to the tickets or the comments.

This ADR was first written choosing **Supabase Realtime Broadcast** emitted by a database trigger, on private channels authorized by RLS on `realtime.messages` — the premium-chat path, sub-second and refetch-free. Implementation proved it **impossible on this project**: `realtime.messages` is owned by `supabase_realtime_admin`, and our `postgres` role is not a member of it. `CREATE POLICY ON realtime.messages` fails with `42501: must be owner of relation messages` — via the Management API and in the dashboard SQL editor alike, because both run as `postgres`. Only Supabase's internal `supabase_admin` superuser could create it, which is not reachable at the customer level. A private Broadcast channel with no readable-authorizing policy denies every subscriber, so Broadcast is not merely degraded here — it delivers nothing.

## Decision

**Support realtime is delivered by `postgres_changes` on `support_ticket_comments`, not Broadcast.**

1. **Publish the comments, authorize with the table's own RLS.** `support_ticket_comments` is added to the `supabase_realtime` publication. Realtime's `apply_rls` evaluates the *existing* `support_ticket_comments_select` policy per subscriber, so each connection receives only the INSERT events it may already read: author their own, org admin the org's, master everything, and `is_internal` staff notes never reach a customer. No new policy, and crucially no policy on `realtime.messages`. This reuses the exact authorization that already ships and is tested (`can_read_support_ticket`, SECURITY DEFINER, so it does not recurse through `apply_rls`). Verified on prod 2026-07-17: the author reads the ticket, a foreign-org user does not.

2. **The ADR's goals survive the mechanism change.** Broadcast was chosen for instant, refetch-free delivery. `postgres_changes` reaches the same end: the inserted row rides in `payload.new`, and a dedicated subscription folds it straight into the comments cache with `setQueryData` — no refetch, no dependence on the house `useRealtimeSubscription`'s 2s debounce. The client filters `ticket_id=eq.{id}` so an open thread receives only its own comments. What is genuinely given up versus Broadcast: a little more server work (`apply_rls` per event) and use of the publication. What is gained: it works, and it leans on one already-hardened policy instead of a second one on a table we cannot manage.

3. **Emission is not a trigger.** There is no `broadcast_changes` trigger; publication + RLS is the whole server side. (The trigger written during the Broadcast attempt was applied to prod and then dropped in the same session — it emitted to private channels no one could subscribe to.)

4. **`useTicketChannel(ticketId)` is the one client seam.** It subscribes the ticket's comment inserts and updates the cache, deduping the sender's own echo by `id`. Both the customer `TicketThread` and the master `TicketDetail` mount it against the shared `support-ticket-comments` cache key, so one hook makes both sides live. Broadcast is a delivery layer either way: the row is persisted by the mutation, and an event missed while offline is recovered on the thread's next fetch.

## Consequences

- **Support speaks the same realtime dialect as the rest of the app** (`postgres_changes`), not a bespoke one. The earlier draft's worry — "support is the one feature speaking Broadcast" — is moot; there is no divergence to explain.
- **`realtime.messages` is a dead end on this project.** Any future feature wanting private Broadcast (a copilot-to-human handoff, presence, typing indicators) hits the same ownership wall. The unlock is a Supabase support request to grant `supabase_realtime_admin` to `postgres` (or to create the policy for us); until then, private Broadcast is not available and `postgres_changes` is the pattern.
- **No `realtime.messages` policy means no second place for a tenant-isolation mistake.** Authorization lives in exactly one policy, `support_ticket_comments_select`, covered by the desk's existing tests.
- **INSERT-only today.** Default `REPLICA IDENTITY` carries the full new row for INSERTs. When live status/assignment updates arrive (the fourth surface), UPDATE events on `support_tickets` will need the table published and possibly `REPLICA IDENTITY FULL` — a separate, single step.
- **Deferred, unchanged from the desk's roadmap**: typing indicators and presence (would want Broadcast, hence the Supabase unlock above), read-receipts as a persisted fact, and inbound-email-to-thread (ADR-0018's binding constraint).
