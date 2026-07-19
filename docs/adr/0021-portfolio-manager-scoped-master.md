# 21. Gestor de Portfólio is a scoped Master, granted by unioning bound orgs into the RLS membership helpers

Date: 2026-07-19

## Status

Accepted

## Context

Torque needs a new actor: a **Gestor de Portfólio** who oversees a chosen subset of Organizations on behalf of someone (an agency, a partner, a regional manager). The framing from the outset was "abaixo do Master, muito parecido com o Master" — the Master picks which Orgs a Gestor reaches, and the Gestor works those Orgs.

Two facts about the existing system shape every option:

1. **There are exactly two actor storage models today.** A normal user belongs to an Org through a `team_members` row (`user_id + organization_id + role`), and the Org-switcher lists those rows. A **Master** is stored out-of-band in `master_users` (a `permissions` JSONB, `all` bypasses everything) and is a **shadow user**: it has no `team_members` row, yet `useCurrentTeamMember` mints a *virtual* member (`master-virtual-<userId>`, role `admin`, never persisted) so the org-context machinery works, and `useOrgSwitcher` lists **all** Orgs for it. DB-side, Master reaches data because policies carry `is_master_user()` next to the tenant check.

2. **RLS is the real write gate, and it funnels through two `SECURITY DEFINER` helpers.** `get_my_organization_ids()` (read policies) and `get_my_admin_organization_ids()` (admin-write policies) both read `team_members` by `auth.uid()`. Inline `SELECT ... FROM team_members` in policies is banned (Realtime `apply_rls()` recursion — see the WhatsApp/Realtime hardening migrations); everything goes through the helpers.

The design question the Gestor forces: **is it a member or a Master?** If it is a member, the cheap move is to insert `team_members` admin rows in each bound Org — everything (switcher, RLS, permissions, edge functions) "just works." If it is a Master, it is a shadow user scoped to a whitelist instead of all Orgs.

Two requirements settle it. The Gestor is **cross-org** (spans many Orgs, managed centrally by the Master), and it must **not pollute the Team Member concept** — it should consume no seat, never appear in a client's team roster, and never be assignable as a Lead's Pré-vendas/Closer. `team_members` admin rows fail both: they are per-Org (no central identity), they count as seats, they surface in Equipe, and they are assignable. So the Gestor is a **scoped Master**, not a member.

The access level was interrogated and deliberately reversed mid-design: an initial **read-only observer** framing was rejected in favor of **full operational write** — the Gestor operates each bound Org exactly as an `admin` would, with two carve-outs (below). "Somente visualizar" was superseded; "muito parecido com o Master" won.

## Decision

1. **The Gestor de Portfólio is a scoped Master — a shadow user over a whitelist of Orgs.** Stored out-of-band like the Master, never in `team_members`. Two tables: `gestores` (`id`, `user_id`, `is_active`, `notes`, `created_at` — mirrors `master_users`) and `gestor_organizations` (`gestor_id + organization_id` — the Master-managed binding, mirroring the Meta Asset Binding pattern). Tables use the `gestor_` prefix, **not** `portfolio_`, because "portfolio" is already Carteira's word (`20261018000000_portfolio_rpcs.sql`).

2. **Access propagates by unioning bound Orgs into the two RLS helpers — one change reaches every policy.** `get_my_organization_ids()` unions the caller's `team_members` Orgs with its active `gestor_organizations` Orgs → read everywhere. `get_my_admin_organization_ids()` unions the caller's admin Orgs with its `gestor_organizations` Orgs → admin-write everywhere. Because ~all tenant policies already funnel through these two `SECURITY DEFINER` helpers, the Gestor inherits read + admin-write across its bound set without touching N tables. The union keeps the helpers `SECURITY DEFINER` and non-recursive (they read `gestores`/`gestor_organizations`, not the calling table).

3. **Full operational Org-Admin write, with two carve-outs below the `admin` ceiling.** The Gestor runs the sales operation of each bound Org like an `admin` (moves cards, edits Leads, changes settings, connects WhatsApp/integrations, fires campaigns). It does **not** touch the Org's **billing/plan** (already `is_master_user()`-gated, so the union grants it nothing — free) and does **not** manage the Org's **admin/member roster or role permissions** (gated by the admin helper, so this **requires explicit exclusion** of Gestor-origin access in those specific policies — the one place the union must be clipped). Rule of thumb: *running the Org's operation* = yes; *the Org's contract or org-structure* = no.

4. **Frontend reuses the shadow-user machinery, scoped.** `useOrgSwitcher` lists the Gestor's bound Orgs (whitelist) exactly where it lists all Orgs for a Master. `useCurrentTeamMember` mints the same virtual `admin` member for a Gestor in a bound Org (`isMaster || (isGestor && orgIsBound)`), so no operational screen is rebuilt. The `master-virtual-<id>` id is **never persisted to a FK** — the same rule that already protects the Master (fix `8f63435e`).

5. **Boot gate order: Master → Gestor → member.** A logged-in Gestor lands in a new **Área do Gestor** (`/gestor`) — an enxuto hub listing bound Orgs (each a door that sets `selected_org_id` + enters the normal operational app) plus the existing Support panel. Zero bound Orgs → an empty state, never a broken app. `/master/*` denies Gestor; `/gestor` denies non-Gestor. This is the "área do gestor" that stands in for the Master area.

6. **Edge functions are taught to recognize the Gestor at the shared choke point.** Many edge functions authorize by resolving `user → team_member`; a Gestor has none and would be denied, breaking writes that route through functions (move stage, send message). `_shared/permission_engine.ts` + `_shared/user-auth.ts` resolve a Gestor as `admin` of a bound Org in **one** place, covering the majority; the residual is a bounded audit of functions that authorize by hand. Accepting a "gestor writes via RLS, edge-fn actions silently fail" gap was rejected — it contradicts "full write."

7. **Every Gestor write is attributed to the real actor.** `runtime_logs` (ADR-0017) tags Gestor actions with `actor_type: gestor` + `gestor_id` + `organization_id`; existing per-actor trails (`lead_history`, `master_audit_log`) record the Gestor as itself, never anonymised. A cross-org actor writing in different clients' data without a forensic trail is a trust hole; the virtual id is UI-only and never the recorded author.

8. **The Master area manages Gestores.** A new master page "Gestores" (mirroring `MasterUsers`/`MasterOrganizations`) creates/deactivates Gestores and binds/unbinds Orgs via a multi-select, gated by a new `gestores` key in the `master_users` permissions JSONB. Provisioning is a service-role, master-gated edge fn (`create-gestor` / `manage-gestor-orgs`). A user may be **both** a Gestor and a real `team_member`/admin elsewhere — the helper union simply merges the sets, no special handling.

9. **The Chamado stays anchored to an Org.** A Gestor opens Chamados from within a bound Org (or picks one), so `organization_id` + Support Context are captured normally and the existing support desk is unchanged — plus an author marker so staff know the author is a Gestor, not a Team Member. An org-less "gestor-level" ticket was rejected: it would fork the Chamado model and break Severidade/Defeito cross-tenant accounting.

## Considered options

- **`team_members` admin rows per bound Org (rejected).** Cheapest to wire — switcher, RLS, permissions, edge functions all "just work." Rejected because it makes the Gestor a member: no central cross-org identity, consumes seats, appears in the client's Equipe, becomes assignable as Pré-vendas/Closer, and reduces to "a user who happens to be admin of several Orgs" — which is not a new, centrally-governed, below-Master actor.

- **Read-only observer with a curated multi-org cockpit (rejected mid-design).** The original framing. A dedicated read-only area is safe-by-construction (no write buttons to suppress). Rejected when the requirement flipped to full write — a read-only Gestor could not "fazer alterações nas orgs vinculadas."

- **Full app read-only via global suppression (rejected with the read-only framing).** Reuse the whole operational app, hide every write CTA, deny writes. Rejected as both un-world-class (an operational app full of dead buttons) and, once write was required, moot.

- **Per-table RLS grant instead of helper union (rejected).** Add a Gestor branch to each table's policies. Rejected: touches N tables, invites drift, and duplicates what two `SECURITY DEFINER` helpers already centralize.

## Consequences

- **Positive.** Reuses the proven shadow-user + Org-switcher pattern; access propagates through two functions instead of N tables; the Team Member concept stays clean (no seats, no roster pollution, no assignment); read/write scoping is a DB-level guarantee, not button-hiding; the Chamado model and support desk are untouched.

- **Negative / watch.** The union widens two hot `SECURITY DEFINER` helpers used by nearly every policy — a correctness bug there is cross-tenant, so it needs RLS tests (Gestor reads/writes bound Org = OK; unbound Org = 0 rows / denied; Gestor cannot write billing or the admin roster). Carve-out #2 (admin roster/permissions) is the one spot the union must be explicitly clipped — easy to forget. Edge-fn recognition is centralized but not automatic; the by-hand authorizers remain a residual audit. Unbinding an Org must revoke access immediately (helpers recompute per call; frontend caches invalidate on switch).
