# Strict lead ownership — Melhoramentos Higiene

## Requested behavior

The user explicitly authorized activation for Melhoramentos Higiene on 2026-10-13.
Members must automatically see only leads assigned to them; org administrators
see all leads, including unassigned ones, and distribute them. This must be a
server-enforced organization policy, not a user-selected UI filter. Other
organizations retain their existing behavior. Existing and future members inherit
the same policy.

## Implementation

The existing organization defaults for `leads.view_all`, `leads.view_unassigned`,
and `leads.view_subordinates` are set to false, along with `leads.reassign`.
`chat_restrict_to_owner` is enabled for the target organization. Existing per-member
overrides are checked before activation (none exist in this organization).

The new `feature_flags.strict_lead_owner_access` opt-in adds restrictive policies
on `leads` and `pipeline_entries`. The latter also protects the invoker view
`negocio_projetado`, which previously returned every business record even when
the lead itself was hidden. The opt-in starts disabled everywhere; the operational
activation enables it only for the requested organization.

Ownership includes active team membership and the existing canonical pre-sale /
sale assignments, legacy aliases, pipeline assignment, and explicit co-ownership.
Admin exemptions are scoped to the organization; a global legacy admin role or
admin membership of another organization does not widen access here. Platform
master and trusted service-role operations retain their existing access.

BEFORE triggers prevent restricted members from changing lead/entry ownership,
organization, record identity, entry lead/deal links, or the ownership table.
They retain JWT checks when reached through a SECURITY DEFINER RPC. Ordinary
notes/stage edits on assigned records remain allowed. Backend service-role
operations remain trusted; this is not a rewrite of every privileged Edge API.

## Validation and rollout

The dev Supabase project is retired; Docker is unavailable on the operator host.
Validation uses pinned PGlite 0.5.8 with the repository's production-derived RLS
fixture, real PostgreSQL roles, policies, triggers, and invoker views. It reproduces
the prior leak before applying the actual migration, tests positive/negative
access and assignment changes, then executes the rollback and checks equivalence.

Run `node --test tests/integration/strict-lead-owner-access.test.mjs` after installing
the repository dependencies. `PGLITE_PACKAGE_ROOT` can select an isolated package
installation for operational validation without changing repository dependencies.

Production baseline: 4 active leads, 3 unassigned, 1 assigned to Alexandre;
8 pipeline entries; 9 active members and 4 active org admins. No organization
defaults/member overrides and `chat_restrict_to_owner=false` before activation.
Every member could read all 4 leads and all 8 entries.

Before activation: capture settings, run the migration with no flag enabled,
check advisors, and validate production role queries. Then activate the target's
settings in one transaction and verify all 13 users, with rollback ready.

The CLI-created migration was ordered after the existing future-dated baseline
because it depends on `lead_owners`. Record the actual remote ledger version after
MCP apply; never reapply solely because local and remote timestamps differ.

## Rollback

Restore only the target's four defaults, chat setting, and opt-in flag from the
captured baseline. Leave unrelated feature flags untouched. Schema rollback is
`supabase/migrations/rollback/20271117000101_strict_lead_owner_access.sql`; it removes
only the policies, triggers, and helpers introduced by this change.
