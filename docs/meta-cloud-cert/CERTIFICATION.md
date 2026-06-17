The two load-bearing facts are confirmed against real code: `resolveInstance` (whatsapp-dispatch.ts:124-137) has NO provider filter, and `getWhatsAppProvider` (whatsapp-client.ts:200, 275) narrows to `"uazapi"|"evolution"` and throws on any third value. Both verdicts are accurate. Producing the certification.

# CERTIFICATION — Meta WhatsApp Cloud API as Third Provider
**Branch:** `feat/meta-cloud-api` (off `main`) · **Scope:** per-instance granularity, Embedded Signup, full template CRUD · **Constraint:** zero Uazapi behavioral change

---

## 1. VERDICT

**GO-WITH-CONDITIONS.** Meta Cloud API *can* be added as a third provider without breaking Uazapi, but **NOT** as the prior audits' "additive-only" framing claims. Verified against real code, three independent touchpoints converge on the same single break: `resolveInstance()` (`whatsapp-dispatch.ts:124-137`) selects the org's first instance by `created_at ASC` with **no provider filter**, and `getWhatsAppProvider()` (`whatsapp-client.ts:200,275`) narrows `effectiveProvider` to `"uazapi"|"evolution"` and **hard-throws** on any third value. The instant a `provider='meta_cloud'` row is *insertable* (the DB CHECK widening — the enabling gate), a mixed org's copilot/follow-up/campaign/pipe auto-dispatch can resolve the Meta instance and either throw `provider_init_failed` (Uazapi lead gets no reply) or, once a MetaCloudProvider exists, silently mis-route a free-form Uazapi reply through Meta's 24h-gated API. This is a real, reachable Uazapi regression caused purely by the additive migration — exactly the locked mixed-provider config. It is fully preventable. The path to GO is: ship the provider-aware dispatch resolver, the meta_cloud factory branch, and the OAuth-state HMAC **before** the CHECK migration lands, and obey the Isolation Contract below. **Do not merge or deploy the migration ahead of the code.**

---

## 2. ISOLATION CONTRACT (non-negotiable)

Every rule below keeps Uazapi byte-for-byte identical. Numbered for PR-review sign-off.

1. **Provider-scope the resolver.** `resolveInstance()` / `resolveDispatchContext()` (`whatsapp-dispatch.ts:107-138`) MUST exclude `meta_cloud` from the legacy "first instance of the org" fallback (`.in("provider",["uazapi","evolution"])` or an explicit `desiredProvider`). A Uazapi-intended auto-dispatch must NEVER resolve a Meta instance. This is THE break — fixing only the factory is insufficient.

2. **Patch every duplicated inline resolver, not just the shared one.** Same provider-blind `.order(created_at).limit(1)` pattern lives inline in `agent-message:423-429`, `campaign-rule-dispatch:870-876`, `pipe-rule-dispatch:916`, `semi-automatic-dispatch:195`, `outbound-sender:87`, `followup-sender:60`, `message-gateway:423`, `_shared/action-handlers/whatsapp-helpers.ts:52-61`, `_shared/actions/send-document.ts:288`, `copilot-v2-worker:160`, `carteira-bulk-message:134`. `requireConnected:true` is NOT sufficient — a Meta instance carries `status='connected'`, the same string Uazapi uses.

3. **Factory: add meta_cloud branch, keep the throw.** `getWhatsAppProvider()` MUST gain an explicit `effectiveProvider === "meta_cloud"` branch (real `MetaCloudProvider`) **before** the terminal `throw new Error("Unknown provider…")` (line 275), which must remain loud for genuinely unknown values. Uazapi and Evolution branches stay byte-for-byte unchanged, in order, first.

4. **Widen the narrow type at line 200 in lockstep with the union.** Widening `WhatsAppInstance.provider` (line 31/177) WITHOUT widening `let effectiveProvider: "uazapi"|"evolution"` (line 200) is a guaranteed TS2322. **CI has no tsc gate** — it ships to the runtime throw. Update all three sites + the `whatsapp-api-proxy:216,223` casts atomically.

5. **Kill-switch must be provider-aware OR Meta-excluded.** `organizations.whatsapp_provider_override` is org-wide; the product is per-instance. **Decision required (see §5).** Either: (a) keep override `CHECK IN ('uazapi','evolution')` and have the factory IGNORE the override when `instance.provider==='meta_cloud'`; or (b) move to a per-instance override. Do NOT widen the override CHECK to include `meta_cloud` without a provider-compat guard — `override='meta_cloud'` would coerce healthy Uazapi instances into the Meta branch and kill their sends; `override='uazapi'` would conversely kill Meta instances.

6. **24h-window + template gate lives INSIDE `MetaCloudProvider.sendText/sendMedia`, never in the shared path.** The guard must run only for Meta and be server-side (copilot/cron/workflow never touch the frontend composer). `whatsapp-dispatch.ts` and `message-gateway.ts` have ZERO window logic today — the Uazapi free-form send path must remain byte-identical, no window check, no template coercion.

7. **Meta-only capability methods throw `NotSupportedError` with the literal `"does not support"` substring.** Mirror Evolution exactly so the frontend `isFeatureUnavailable()` matcher (`useMessageActions.ts:101-109`) keeps surfacing the correct toast. A different message surfaces a raw 500. UazapiProvider must STILL expose all those methods (regression guard).

8. **`whatsapp-webhook/` stays untouched.** Cloud inbound extends `meta-webhook/` only. Meta inbound MUST NOT write `whatsapp_webhook_dlq` nor carry `uazapi_token` (dlq-replay would re-POST it as a Uazapi event). The idempotency contract test auto-polices any `whatsapp_messages` write.

9. **Credentials fail-closed and isolated.** Meta system-user/WABA token goes in `whatsapp_instance_secrets` (RLS deny-all) via a service-role `get_meta_cloud_credentials` RPC — NEVER in `meta_pages.page_access_token`, a selectable `meta_*` column, or `whatsapp_instances.provider_config` JSONB (any org `membro` can `select` those). Add an RLS test asserting `authenticated` cannot read the token.

10. **OAuth `state` must be unforgeable.** `meta-oauth-callback` decodes `state` as plain base64 with no HMAC/nonce, then writes via service_role. HMAC-sign `{userId, orgId, nonce, exp}` (or one-time nonce row) AND re-derive `orgId` from the authenticated user's `get_my_organization_ids()` membership before any service_role write. Reject mismatches. (Tenant-binding forgery — critical.)

11. **Per-WABA inbound binding, not just global HMAC.** `meta-webhook` HMAC proves *Meta sent it*, not *which tenant*. Resolve org strictly from a provisioning-verified `phone_number_id`→instance mapping (created only by the signed-state flow), with a table-wide UNIQUE on the external id. Reject inbound with no active provisioned row.

12. **`MassSend.tsx:68` filter (`provider==='uazapi'`) stays default-deny for Meta.** Meta has no `/sender/*` mass send. Keep the allowlist positive; update empty-state copy, never the semantics.

13. **Chat capability gating must first SELECT `provider`.** The chat path (`useWhatsAppInstancesForUser`, `hooks/chat/useWhatsAppInstances.ts:28-33`) does NOT fetch `provider`. Any `provider === 'uazapi'` check there is `undefined === 'uazapi'` → false → Uazapi action bar vanishes for all orgs. Add `provider` to the SELECT + type, thread it down `MessageList→MessageBubble→MessageBubbleActions`, and gate **positively**: render Uazapi actions when `provider == null || provider === 'uazapi'`. Never `!== 'meta_cloud'`.

14. **`channel_messages` RLS uses the multi-org helper.** Any new/modified `channel_messages` or `meta_message_templates` policy MUST use SECURITY DEFINER `get_my_organization_ids()` / `get_my_admin_organization_ids()` + `is_master_user()` branch — NEVER inline `team_members` (Realtime `apply_rls()` recursion kills ALL publication tables) and NEVER subquery a table whose own policy re-enters `team_members`.

15. **Migration sequencing + safety.** Widen the CHECK via named `DROP CONSTRAINT` + `ADD CONSTRAINT` (find the unnamed inline constraint via `pg_constraint`). Verify `supabase db reset` + `INSERT provider='meta_cloud'` succeeds and invalid still rejects. Apply migration only AFTER the meta_cloud-aware code is deployed in every edge bundle that calls `getWhatsAppProvider` (force-import `meta-cloud-provider.ts` into the eszip — see the REALSC dynamic-import incident).

---

## 3. BLAST-RADIUS TABLE

| Touchpoint | Classification | Uazapi Impact | The one rule that keeps it safe |
|---|---|---|---|
| `whatsapp-webhook/` (Uazapi inbound) | **untouched** | none (file) / **medium (outbound it triggers)** | Rule 8: never edit; Cloud inbound extends `meta-webhook` only |
| `getWhatsAppProvider` factory | **modified-backward-compat** | low | Rule 3+4: meta_cloud branch before the throw; widen line 200 in lockstep |
| `resolveInstance` / dispatch | **modified-risky** | **high (mixed orgs)** | Rule 1+2: provider-scope the resolver; patch all inline copies |
| Kill-switch override | **modified-risky** | **medium (mixed orgs)** | Rule 5: provider-aware OR exclude meta_cloud; don't widen CHECK blindly |
| 24h window guard | **additive-only** | low | Rule 6: gate inside `MetaCloudProvider.sendText`, never shared path |
| `whatsapp-api-proxy` dispatch | **modified-backward-compat** | low (own path) / high (writes shared table) | Rule 4: default stays `uazapi`; createInstance rejects meta_cloud (forced via OAuth) |
| `meta-webhook/` extension | **additive (requires-guard)** | none (if Rule 1 holds) | Rule 11: per-WABA org binding, not just global HMAC |
| DB CHECK + cols + tables + RLS | **additive (requires-guard)** | low | Rule 15: named DROP/ADD, sequence after code; Rule 14: helper-based RLS |
| Auto-gen types + union exhaustiveness | **modified-risky** | low | Rule 4: widen union + audit every `=== 'uazapi'` / `as any` cast |
| Frontend picker + capability gating | **modified-backward-compat** | **high (chat path)** | Rule 13: SELECT provider first; positive allowlist gating |
| Copilot/workflows/campaigns/history-sync | **modified-backward-compat** | none (own) / medium (resolver) | Rule 1+6: provider-scoped resolution + Meta window in provider |
| OAuth callback / token storage | **modified-risky (security)** | n/a (new attack surface) | Rule 9+10: HMAC state + deny-all token storage |

---

## 4. RESIDUAL RISKS (survived verification, severity ≥ medium)

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| R1 | **Mixed-org dispatch hijack.** Meta row selected by provider-blind resolver → Uazapi reply throws or mis-routes through 24h-gated Meta. The dominant break, confirmed in 4 touchpoints. | **High** | Rules 1+2+3+6. Pin with the mixed-org regression test (§6). Gate the CHECK migration on this code existing. |
| R2 | **OAuth `state` forgery** binds a victim org's WABA + system-user token to an attacker (or overwrites the victim's number). No HMAC/nonce; service_role write. | **Critical** | Rule 10. HMAC-signed state + server-side org membership re-derivation. Security section mandatory in PR. |
| R3 | **WABA/system-user token leak** via direct PostgREST `select` if stored in a selectable column. Any `membro` exfiltrates the org's send credential. | **Critical** | Rule 9. Deny-all `whatsapp_instance_secrets` + service-role RPC. RLS test. |
| R4 | **Forged `phone_number_id`/WABA id** routes attacker inbound (with PII) into a victim org — global HMAC can't stop it. | **High** | Rule 11. Provisioning-verified mapping + table-wide UNIQUE + reject-unprovisioned. |
| R5 | **Realtime `apply_rls()` recursion** if a new `channel_messages`/template policy inlines `team_members` → global chat-realtime outage for all orgs. | **High** | Rule 14. SECURITY DEFINER helpers only; CI scan gate for inline `FROM team_members` in publication-table policies. |
| R6 | **Type-union drift invisible to CI** (no tsc gate; Deno `--no-check`). A forgotten `meta_cloud` branch ships green, 500s in prod. | **High** | Rule 4 + add `deno check` (or drop `--no-check`) + the factory default/unknown-provider unit test (§6). |
| R7 | **Split-brain inbox** — Cloud inbound to `channel_messages` is invisible to the WhatsApp chat (reads `whatsapp_messages`); to `whatsapp_messages` needs non-null `instance_id` + wamid satisfying `UNIQUE(message_id,instance_id)`. | **Medium** | §5 architecture decision + provider-aware chat read; integration test: Cloud inbound appears exactly once in the chat opened. |
| R8 | **`channel_messages` RLS uses singular `get_user_organization_id()`** (one org) while `meta_conversations` uses plural — multi-org users + masters see inconsistent/empty Meta data (master-ghost class). | **Medium** | Rule 14. Migrate `channel_messages` policy to `get_my_organization_ids()` + master branch. |
| R9 | **`meta-webhook` swallows per-entry errors + early 200, no DLQ.** Cross-tenant mis-attribution or insert failure ships silently. | **Low→Medium** (masks R4) | Add `meta_webhook_dlq` mirror + Sentry on page/WABA-not-found and org-mismatch. |

No residual risk is a clean cross-tenant *read* of existing data; the dominant risks are mis-routing (R1), new credential/binding attack surface (R2-R4), and recursion (R5). All are preventable pre-merge.

---

## 5. THE ARCHITECTURE DECISION (make before coding)

**Where does Meta WhatsApp Cloud inbound land — `channel_messages` or `whatsapp_messages`?**

The facts (verified): the live WhatsApp chat reads `whatsapp_messages` (`useWhatsAppMessages.ts:41`, 23+ call sites), keyed by `(organization_id, instance_id, phone_number)`, `UNIQUE(message_id,instance_id)`. `channel_messages` serves live Messenger/IG and holds only a **one-time stale snapshot** of WhatsApp (migration `20260717000001`, `ON CONFLICT DO NOTHING`, never re-synced). The prior audit claim that "channel_messages is the unified WhatsApp table" is **false for the rendered surface**. `channel_messages` also carries the `trg_meta_conv_upsert` trigger (guarded to skip non-messenger/instagram — `channel='whatsapp'` is safe today but fragile).

**Recommendation: write Cloud inbound to `whatsapp_messages`** (with a `provider='meta_cloud'` `whatsapp_instances` row so `instance_id` is non-null and the Cloud `wamid` populates `message_id`). Rationale: it makes the WhatsApp chat, copilot inbound reads, realtime subscription, and the idempotency contract test work *with zero new read-path code* — Meta WhatsApp is a WhatsApp number, and the user thinks of it as one inbox. Writing to `channel_messages` would require a provider-aware chat read rewrite (R7) and risks the meta-conversation trigger. **Trade-off accepted:** Cloud outbound status updates arrive as separate webhooks keyed by `wamid` — the writer MUST use the real `wamid` (not an RNG id) so status callbacks update the right row (avoids the dup/stuck-message hazard). Keep Messenger/IG on `channel_messages`; do not unify reads across both tables for one conversation.

---

## 6. REGRESSION GATE — "no new failures vs the captured baseline"

**Baseline is NOT all-green.** `build` is the load-bearing green gate; the unit suite carries ~40 pre-existing failures. Procedure:

```bash
git stash && git checkout main && npm run test:unit > baseline.txt   # capture failing test IDs
git checkout feat/meta-cloud-api && git stash pop && npm run test:unit > branch.txt
# DIFF: any test ID failing on branch but NOT on main = Meta-induced regression = BLOCKS merge
```

**Gate commands (run all):**
```
npm run build              # load-bearing, must stay GREEN
npm run lint
npm run typecheck:ratchet  # .tsc-baseline.json ratchet — must not regress
npm run lint:deps:check
npm run test:unit          # diff vs baseline, no NEW failures
npm run test:coverage      # enforces global floor + meta-api.ts per-file (lines100/branches93)
npm run test:edge          # CI-only (Deno not local) — verify GREEN in CI edge job
npm run test:edge:coverage # CI-only
```
Coverage caveat: put new Cloud send/inbound logic in a **new** `_shared/whatsapp-providers/meta-cloud-provider.ts` with its own tests — do NOT fatten `meta-api.ts` (per-file branches:93 gate goes red even with all tests passing).

**Uazapi pinning tests that MUST stay green (must-not-regress):**
`tests/unit/whatsapp-adapter.test.ts` (factory dispatch), `uazapi-provider.test.ts`, `uazapi-client.test.ts`, `uazapi-payload-resolution.test.ts`, `uazapi-provider-sender.test.ts` (`/sender/*`), `whatsapp-api-proxy.unit.test.ts`, `whatsapp-messages-idempotency-contract.test.ts` (global write policy), `whatsapp-webhook-idempotency.test.ts`, `evolution-api.test.ts`, `history-sync.test.tsx`, `shared-meta-api[-branches].test.ts`, `meta-window-warning.test.tsx`, the Messenger/IG `meta-*-hook` suite, `mass-send-create-permission.test.ts`. *(Known local-Windows-only false negatives — NOT regressions: idempotency-contract walk() backslash paths; uazapi-provider createInstance/historySync fake-timer ~5s timeouts.)*

**New tests required (block merge until green):**
1. **Factory:** `getWhatsAppProvider(provider='meta_cloud')` → `MetaCloudProvider`, never calls `get_uazapi_credentials`, needs no `UAZAPI_*` env. Override path still wins for uazapi/evolution; override does NOT coerce a meta_cloud instance. Unknown provider still throws loudly.
2. **Mixed-org resolution (THE break):** org with 1 uazapi + 1 meta_cloud (Meta older `created_at`) → provider-blind auto-dispatch resolves the **uazapi** instance; no override value can break the instance whose provider differs.
3. **24h guard is Meta-scoped:** `sendTextViaInstance` on a uazapi instance sends free-form byte-identically regardless of last-inbound age (no window check); meta_cloud outside 24h is blocked/template-required. Helper returns window-CLOSED when no recent incoming whatsapp row (guards against schema-rename silently re-opening).
4. **Capability gating:** `MetaCloudProvider` throws `NotSupportedError` (`"does not support"`) for `sendMenu/sendPixButton/react/edit/pin/deleteForAll/markRead/historySync/sender*`; UazapiProvider STILL exposes all of them.
5. **MassSend filter:** still includes uazapi, now EXCLUDES meta_cloud.
6. **Cloud inbound routing:** `payload.object==='whatsapp_business_account'` → Cloud handler in `meta-webhook`, never reaches `whatsapp-webhook`; any `whatsapp_messages` write satisfies the idempotency contract.
7. **Migration:** CHECK widen is idempotent named DROP/ADD, succeeds with existing rows, accepts `meta_cloud`, rejects invalid (pgTAP / integration).
8. **Security:** RLS test — `authenticated` cannot SELECT the Meta token column; OAuth state forgery (mismatched `orgId`) is rejected; org A cannot send via org B's `phone_number_id`.
9. **Chat-path provider:** a provider-less (Uazapi) instance renders the action bar exactly as today (snapshot/integration), proving Rule 13 added `provider` without regressing existing orgs.

**Merge gate = CI `unit-tests` (runs `test:coverage`) + `edge-function-tests` jobs GREEN, with zero new unit failures vs captured `main` baseline.** A passing local run is NOT proof the edge job is green (Deno not installed locally).