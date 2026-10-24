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

The second migration adds explicit ownership predicates to 71 internal source
views and 66 related-table SELECT policies, then redirects 66 existing reader /
chat functions to the scoped sources without changing their tenant checks or
grants. CTE references are preserved. The views and restoration catalog are not
readable by API roles. Related contacts/deals, histories, message caches, phone
and social identities, and push recipients follow the same scope. Independent
contacts/calendar items with no source lead remain subject to existing policies.
Opening a new deal for an already owned lead can inherit existing owners and
link its new deal identity; members cannot add arbitrary assignees.

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

Activated in production on 2026-10-13, following the user's explicit instruction.
Both schema migrations were first applied with the flag disabled. The 13-user
production result matrix was identical before/after this step. The target's
four defaults, chat setting and opt-in flag were then changed in one transaction.
Exactly one organization has this flag enabled.

Verification after activation:

| Actor | Leads | Pipeline entries | Funnel/productivity lead lists |
|---|---:|---:|---:|
| Each of 4 org administrators | 4 | 8 | 4 |
| Alexandre | 1 | 2 | 1 |
| Each of 8 remaining members | 0 | 0 | 0 |

All 9 members fail the unassigned-lead chat gate; all 4 administrators pass.
Actual password-authenticated HTTP sessions for Alexandre, Daniel and Marco
confirmed table/projection/RPC results and direct-ID denial for unassigned leads.
Only the test-created sessions were logged out. No lead assignments were changed.
Security advisor comparison found zero new findings (preexisting findings remain).

Seven PGlite integration tests pass, including actual production reader bodies,
the production proposal snapshot trigger, positive/negative ownership, social /
phone-only conversation lookup, push recipient identity, cross-org admin roles,
service access, and exact restoration of original public RPC definitions.
The two review passes' blocking findings were corrected before production apply.

The CLI-created migrations are ordered after the repository's future-dated
baseline because they depend on `lead_owners`. MCP uses the current UTC time for
remote ledger versions. This is declared timestamp drift; do not apply them again:

| Local file prefix | Remote ledger version | Name |
|---|---|---|
| 20271117000101 | 20261013153144 | strict_lead_owner_access |
| 20271117000102 | 20261013153155 | strict_lead_owner_readers |

Operational evidence and preactivation settings are saved in the operator's
`outputs/melhoramentos-native-access-20261013` directory (no passwords or tokens).
Future reader replacements must retain these scoped sources or equivalent
ownership predicates. The restoration catalog deliberately refuses to overwrite
an RPC changed after this rollout.

## Rollback

Restore only the target's four defaults, chat setting, and opt-in flag from the
captured baseline. Leave unrelated feature flags untouched. To roll back schema,
apply `supabase/migrations/rollback/20271117000102_strict_lead_owner_readers.sql`
first, then `supabase/migrations/rollback/20271117000101_strict_lead_owner_access.sql`.
These restore the original RPC definitions and remove only this rollout's
policies, triggers, helpers, source views, and schema-restoration catalog.
