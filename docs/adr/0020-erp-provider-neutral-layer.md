# 20. ERP is a provider-neutral layer, and the ERP owns the money

Date: 2026-07-15

## Status

Accepted

Extends ADR-0005 (Carteira is a post-sale analytics surface over `upsell_clients`, not a kanban) — the money layer this ADR introduces deepens that surface; it does not add a board.

## Context

Torque already integrates one ERP, TinyERP, and it is hardcoded end to end: `_shared/tinyerp-utils.ts` is bound to Tiny's form-encoded single-token convention, ten edge functions carry `tinyerp-` in their names, and the columns that receive ERP data are named `tiny_*` (`upsell_clients.tiny_contact_id`, `upsell_orders.tiny_order_id`). There is no `ERPProvider` interface, nothing like the `whatsapp-providers/` adapter pattern. The Tiny integration answered "which ERP" with a vendor name baked into every layer.

Omie is not the second-and-last ERP; it is the first of several we intend to connect. That forces the question the Tiny integration never had to ask: **is an ERP a vendor or a capability?** If it is a vendor, we get a second hardcoded copy and a third one after that. If it is a capability, we build the seam once and each ERP is an implementation behind it.

Omie also earns its place for a reason parity with Tiny would not justify: it exposes **faturamento (NF-e)** and **contas a receber (títulos)** — revenue-recognized and payment-status data the CRM structurally cannot see on its own. That is net-new domain, not a new sync of existing domain: Carteira today has no column, table, or glossary term for money received. Connecting Omie is therefore also a domain-model expansion, and the highest-value thing it unlocks — **inadimplência / receita-em-risco** — did not exist as a concept in the product before.

Omie's API shape constrains the design and corrects an assumption carried over from the Tiny work. It is **not** OAuth: a static `app_key` + `app_secret` pair sent **in the request body** of a single-endpoint JSON-RPC POST (`{call, app_key, app_secret, param:[...]}`), CORS-blocked (server-side only), with business errors frequently returned as HTTP 200 carrying a `faultstring`. Its rate limits are aggressive and, critically, **per-IP-aggregate**: 960 req/min across a shared IP, four concurrent queries max, **zero** write concurrency, and a 30-minute hard block (HTTP 425) after ten consecutive errors on one method. At ~30 orgs all egressing through our edge functions, that aggregate ceiling — not the per-key limit — is the real constraint.

## Decision

1. **The ERP is a capability, exposed through a provider-neutral contract.** An `ERPProvider` interface lands in the `integrations` bounded context; Tiny and Omie are its first two implementations. It is **not** a lowest-common-denominator interface and **not** a fat interface that throws `NotSupported`. Each provider publishes a **capability manifest** (`clientes`, `pedidos`, `produtos`, `notaFiscal`, `receivables`, `webhooks`) and implements only the **segregated method group** for each capability it declares. ERPs genuinely differ in what they expose; the UI reads the manifest to show or hide each Carteira surface per org, rather than discovering support by trying and failing at runtime.

2. **The ERP owns the money; the CRM owns the relationship.** `NotaFiscal` and `Título` are ERP-sourced and single-source — the CRM holds no competing money data, so there is no conflict to resolve. Client identity is **dual**, matched by **CNPJ**, and reconciled **enrich-only by default**: a per-org `erp_sync_mode` (`off | enrich_only | canonical`) mirrors Tiny's existing `contact_sync_mode`. In `enrich_only`, the ERP fills only empty fields and never overwrites CRM-owned data (name, responsável, tags, pipeline); `canonical` is an explicit opt-in for orgs that trust ERP data more than their own. The three **money-moments — vendido → faturado → recebido** — are distinct and must never collapse: an Order reaching `vendido` is won, not billed; only a NF-e makes it **faturado** (recognized revenue); only a paid Título makes it **recebido**.

3. **External identity is generic, never per-vendor.** The domain tables carry `external_source` (`omie` | `tiny`), `external_id` (the ERP's immutable key — Omie's `codigo_x_omie`), and `external_ref` (our uuid, the bridge that lets Omie `Upsert*` without our knowing its id — Omie's `codigo_x_integracao`). The `tiny_*` columns are backfilled into these and dropped. `UNIQUE(organization_id, external_source, external_id)` is the idempotency key. Because an org connects **at most one ERP**, a given row maps to exactly one provider — a central `erp_external_refs` mapping table would buy a multi-ERP-per-entity capability nothing uses, at the cost of a join on every Carteira read. `upsell_orders.source` already admits `'erp'`; that stays, and `external_source` says *which* ERP.

4. **The money entities get their own tables.** `notas_fiscais` and `titulos_receber` are new, carry the same generic external columns, and link to the Carteira Client and the Order. `titulos_receber` status is `aberto | pago | atrasado`; the aggregate `atrasado` amount per client is that client's **receita-em-risco**, and **Inadimplência** is the Carteira health signal these tables exist to power.

5. **Credentials are per-org, encrypted, and deny-all.** The two Omie secrets (`app_key` + `app_secret`) live in a dedicated `omie_connection_secrets` table readable only by `service_role` through an RPC — **not** the Tiny pattern, where the encrypted token columns on `tinyerp_connections` are `SELECT`-readable by any org member. Every new policy uses `get_my_organization_ids()` / `get_my_admin_organization_ids()`, never an inline `SELECT ... FROM team_members` (the Realtime `apply_rls()` recursion rule).

6. **Pull by staggered cron now; webhook deferred.** `pg_cron → edge fn` with `x-cron-secret` and a resumable cursor, windows **staggered per org** so ~30 tenants do not fire simultaneously against the shared-IP 960 req/min ceiling. Money entities sync on a short cadence (~1–2h), catalog daily, plus an on-demand "sync now" button for UX. Omie's outbound webhooks are a Phase 3 enhancement, deliberately **not** built until the payload + per-event auth/signature schema is confirmed against a real account — real-time delivery on an unconfirmed contract is rework waiting to happen, and payment status is not second-sensitive.

7. **The Omie client is rate-limit-aware by construction.** Backoff on 429; hard-stop-and-wait on 425 (never hammer a blocked method); **serialize all writes** (Omie forbids write concurrency); cap queries at four concurrent; respect the 60s duplicate-request window. Tiny's naive 2s-per-page pacing is insufficient for Omie's per-method-plus-aggregate model and is not reused.

8. **Delivery order: foundation → money → polish.** **P1** proves the seam and the API — auth, envelope, rate-limit — against `Cliente` + `Pedido`, parity with what Tiny already does and low domain risk. **P2** builds the money layer (`NotaFiscal` + `Título` + inadimplência UI) — the actual reason for Omie and the real domain expansion. **P3** is webhook + produtos + `canonical` sync-mode. Money cannot ship first: inadimplência has nothing to attach a título to without a client identity established.

## Considered options

- **Bolt Omie on parallel to Tiny.** A second hardcoded copy. Rejected — it guarantees divergence and makes the third ERP a third copy; the whole point of connecting a second ERP is to stop paying this cost.
- **A fat `ERPProvider` interface that throws `NotSupported`.** Rejected — capability variance becomes a runtime error the UI discovers by trying, instead of a typed manifest it can read to render the right surfaces.
- **A central `erp_external_refs` mapping table.** Rejected — it models one entity synced from many ERPs, which one-ERP-per-org never does, and taxes every read with a join.
- **ERP canonical for client fields by default.** Rejected — ERP client data is usually worse than the CRM curated by the sales team; overwriting curation by default destroys trust in the feature.

## Consequences

- **We introduce the seam Tiny never had, and must align Tiny with it.** The pragmatic path is to extract the interface, build Omie against it clean, and refactor the ten Tiny functions **lazily** — not rewrite working code on day one.
- **`tiny_*` → `external_*` is a live data migration, already half-started in prod.** As of 2026-07-15, `upsell_clients.external_source` already exists (32 rows set to `tiny`, though `tiny_contact_id` was never populated on them); `external_id` / `external_ref` do not exist yet, and `upsell_orders` carries only `tiny_order_id` (75 `source='erp'` orders, 72 with a real id). The migration adds `external_id` + `external_ref` to both tables, backfills `upsell_orders.tiny_order_id → external_id` under `external_source='tiny'`, reconciles the half-done client state, and drops `tiny_*` only after backfill. Reconcile against **prod, which is ahead of the repo** (known drift — the repo is not the source of truth for what exists in prod).
- **Flag A — resolved (prod verified 2026-07-15).** `upsell_clients.lead_id` is `NOT NULL` in prod and **all 738 Carteira Clients satisfy it**, including the 32 with `external_source='tiny'`. The ERP contact-sync path is not failing — it resolves or creates a `lead_id` before inserting. The recon's fear (inserts failing / a missing `DROP NOT NULL`) was wrong. What remains is a **P1 design task, not a blocker**: how an ERP cliente acquires its lead. An Omie cliente matched by CNPJ must resolve to an existing Lead or create a stub, because a lead-less Carteira Client cannot exist. `leads` has no `cnpj` column, so the match key lives on the Carteira side (`upsell_clients.cnpj`), never on `leads`.
- **Pre-build blockers still open (close before the phase that needs each):** confirm in the Omie developer test panel with a real org — the webhook payload + per-event auth schema (gates P3), the `status_titulo` enumeration for receivables (gates P2 payment-status logic), and that `etapa` codes are per-org configurable (query `pedidoetapas` per org, never hardcode `00/10/50/60`).
- **Deferred on purpose, each a self-contained addition when a real need appears:** Omie webhooks (near-real-time), produtos sync, the `canonical` sync-mode, and any Tiny→Omie data migration for an org that switches vendors.
