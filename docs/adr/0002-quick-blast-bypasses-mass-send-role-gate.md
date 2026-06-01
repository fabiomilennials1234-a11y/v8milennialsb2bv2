# 2. Quick Blast bypasses the Mass Send role gate; org-level cap is the guardrail

Date: 2026-05-29

## Status

Accepted

## Context

The existing **Mass Send (Disparo)** feature (`mass-send-create` edge function + `/campaigns/MassSend` page) is gated to `admin`/`master` roles plus the `mass_send` permission. It dispatches bulk WhatsApp broadcasts through Uazapi's sender, tracked in `uazapi_sender_jobs`.

We are adding **Quick Blast (Disparo Rápido)**: a one-button ad-hoc broadcast fired directly from a kanban/list lead selection ("de supetão", without planning). The product intent is that any salesperson can blast their selected leads on the spot — so the CTO explicitly chose **no role gate** (any logged-in member), against the cautious default of reusing the admin/`mass_send` gate.

This creates a conflict: `mass-send-create` hardcodes the admin gate and is shared with the admin-only CSV page. Relaxing that gate in place would silently open the existing admin page to all members.

A bulk WhatsApp broadcast is a real abuse/reputation vector — an uncapped member could blast thousands of messages and get the Organization's number banned.

## Decision

1. **Dedicated entry path.** Quick Blast does **not** relax the shared `mass-send-create` gate. It uses a dedicated server path that reuses the Mass Send *dispatch core* (Uazapi sender / per-recipient loop, `uazapi_sender_jobs`) but carries its own, ungated authorization. The admin-only CSV Mass Send page keeps its existing gate untouched.

2. **No role gate.** Any authenticated member of the Organization may fire a Quick Blast. RLS still scopes every recipient to the caller's Organization.

3. **Org-level cap is the guardrail.** In place of a permission, an Organization-level hard ceiling on leads-per-blast (default **200**), enforced **server-side**, is the primary safety mechanism. A per-blast max field operates within that ceiling.

4. **Ban-risk mitigation by construction.** Per-recipient personalization (variables + spintax) and a randomized inter-message delay (default 5–30s) are first-class, reducing the repeated-identical-message ban signal.

## Consequences

- A future reader sees a broadcast path with **no permission check** — this ADR is why. It is deliberate, not an oversight.
- The org-level cap becomes a security-critical control. It must be enforced server-side (never client-only) and must fail closed (missing config → default ceiling, not unlimited).
- Two authorization policies now exist for the same domain concept (Mass Send). The dispatch core stays single-sourced; only the entry/auth layer differs.
- If abuse appears in production, the cheapest lever is lowering the org ceiling; re-introducing a role gate is a larger reversal (hence recording the trade-off now).
- Per-recipient logging to `channel_messages` for batch sends is optimistic-at-enqueue and reconciled via the existing `mass-send-status` flow — accuracy of "sent" timestamps is eventual, not synchronous.
