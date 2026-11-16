# Pending support verification — 2026-11-16

Scope: seven pending tickets outside Café Jurerê. Exclude organization
`4922638c-4909-494e-ba10-12282ec0b161` from every operational update and closure.
Production snapshots are retained outside the repository (contain customer data).

## Changes

- `67452a68`: notify-team-member now selects an active member by ID, honors app/WhatsApp/both, validates tenant and phone, and uses the existing fixed-recipient WhatsApp sender. Show sender selection and missing-phone warning. Never attach conversation summaries. Keep app as default.
- `bd8a5fa8`: opt-in `awaitDeliveryConfirmation` on move-stage. Official template callbacks belonging to the same organization and execution must be delivered/read before moving. Pending callbacks defer the same move node; failed callbacks or a 24-hour timeout stop it without moving or re-sending. Enable only on the affected Chiquê workflows; preserve all other organizations' settings.
- `6d8c6c5f`: ranking falls back to the member's configured avatar when their linked profile has no photo. User authorized copying Nicolodi's uploaded photo to his existing member record; no identity/role changes.
- `39981ebb`: user confirmed replacing both HGE notification destinations with the single requested number. Retain one send node and one connected sender; no artificial message.

## Existing fixes to verify

- `52b4f4ca`: Rafthel custom-funnel MOVE fix is already deployed. Three real executions from November 12 each have one entry in Lead Ruim; lose-deal and move both succeeded. Run the existing move-stage regression suite.
- `aff42fb5`: Marcello/Rebran correction remains valid: one entry in Closers and the separate Nutrição entry preserved. Verify proposal and product remain intact; never delete the lead.
- `11291100`: explicit Copilot reactivation clears human pause (existing correction). Five real Copilot messages were delivered on November 16 after the correction. Verify the affected lead and deployed RPC bodies.

## Validation and release

Baseline reproductions: seven notify tests, five delivery/movement tests, and one member-avatar test failed before their fixes.
Focused suite: action handlers, fixed-number sending, workflow dispatcher/deferral, move-stage, editor and avatar map.
Test production callback snapshots without triggering customer communication. Verify the deployed function contains the guard and notification changes, the frontend contains the new controls, and the scoped configuration matches the prepared snapshots.
Record evidence before transitioning verified tickets to `resolvido`; `fechado` is the automatic seven-day lifecycle state.
