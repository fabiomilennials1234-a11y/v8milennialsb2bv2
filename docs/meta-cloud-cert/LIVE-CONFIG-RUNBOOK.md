# Meta WhatsApp Cloud — Live Config Runbook (Step 3)

**Goal:** flip the WhatsApp Business Cloud API (official Meta provider) from INERT to live in prod.
**Decision:** reuse the existing Track A Meta app (Ads/leadgen) — add the WhatsApp product to it.
**Prereq:** Step 2 (deploy) — edge bundles that call `getWhatsAppProvider` must be deployed, and the
`widen_provider_check_meta_cloud` migration applied **last**. Live config is useless until code is in prod.

Prod ref: `jsjsmuncfkbsbzqzqhfq` · Webhook is public (`meta-webhook`, `verify_jwt=false`).

---

## What the code reads (config surface)

| Key | Where read | Status |
|---|---|---|
| `META_APP_ID` | `meta-embedded-signup-exchange`, oauth | ✅ prod (Track A) |
| `META_APP_SECRET` | code exchange, webhook HMAC | ✅ prod (Track A) |
| `META_WEBHOOK_VERIFY_TOKEN` | `meta-webhook` GET verify (`hub.verify_token`) | ✅ prod (Track A) — **reuse same value** |
| `APP_URL` | embedded signup redirect | ✅ prod |
| `META_CLOUD_REGISTER_PIN` | `meta-embedded-signup-exchange` `/register` 2FA PIN | ✅ **set 2026-06-21** (random 6-digit) |
| `VITE_META_APP_ID` | frontend FB JS SDK `FB.init` | ❌ EasyPanel build env — = same value as `META_APP_ID` |
| `VITE_META_WA_CONFIG_ID` | frontend `FB.login({config_id})` | ❌ **created in Meta dashboard (step B3)** |

`whatsapp_instance_secrets.meta_{waba_id,phone_number_id,access_token}` are written **per-org** by Embedded
Signup (service_role RPC `set_meta_cloud_credentials`) — NOT global config. `meta_app_config.system_user_token`
is Track A (agency Ads) only; WhatsApp Cloud does NOT use it.

---

## A. Supabase prod secrets — DONE

- `META_CLOUD_REGISTER_PIN` set via Management API (2026-06-21). Random 6-digit.
  - ⚠️ Caveat: `/register` (POST `/{phone_number_id}/register`) needs the number's two-step PIN to match.
    Registration is **best-effort** (code warns + skips on mismatch). If a number already has a different 2FA
    PIN, either disable 2FA on that number or rotate this secret to match. Non-fatal — send still works once
    the number is connected; `/register` only (re)claims the number to this app.
- All other secrets already present from Track A. Nothing else to set server-side.

## B. Meta dashboard — CTO only (developers.facebook.com → the existing Track A app)

1. **Add the WhatsApp product** to the app (left sidebar → Add Product → WhatsApp).
2. **Business Verification** — likely already done for Ads. Confirm the Business is Verified (required for
   Advanced Access + Embedded Signup).
3. **Embedded Signup configuration** → create one → copy its **`config_id`**. This becomes `VITE_META_WA_CONFIG_ID`.
   - Requires Tech Provider / Solution Partner posture on the app. If the Embedded Signup option is absent,
     the app needs the WhatsApp Business Management API + Tech Provider setup first.
4. **App Review — Advanced Access** for:
   - `whatsapp_business_messaging` (send/receive) — **required**, gated behind review.
   - `business_management` — likely already granted from Track A.
5. **Webhook** (WhatsApp product → Configuration → Webhook):
   - Callback URL: `https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/meta-webhook`
   - Verify token: the **existing** `META_WEBHOOK_VERIFY_TOKEN` value (read it from Supabase dashboard →
     Project Settings → Edge Functions → Secrets). Same webhook already serves leadgen — reuse.
   - Subscribe field: **`messages`** (covers inbound messages + delivery/read statuses). Template approval is
     polled by the `meta-template-sync` cron, so `message_template_status_update` is optional.

## C. Frontend build env — CTO (EasyPanel → service env → rebuild)

- `VITE_META_APP_ID` = the `META_APP_ID` value (read from Supabase secrets).
- `VITE_META_WA_CONFIG_ID` = the `config_id` from B3.
- Until BOTH exist, the "Meta Oficial" connect path is INERT and toasts
  *"configuração Meta pendente (App Review)"* — by design (graceful fallback). Rebuild the Docker image after
  setting them (build-time vars, baked into the bundle).

---

## Go-live order

1. Step 2 deploy (edge fns + CHECK migration last). ← hard prereq
2. B1–B5 in Meta dashboard → obtain `config_id`.
3. C: set both VITE vars in EasyPanel → rebuild frontend.
4. Per-org: open Settings → WhatsApp → "Meta Oficial" → Embedded Signup popup → select WABA + number →
   `meta-embedded-signup-exchange` provisions the `meta_cloud` instance + stores per-org token.
5. Smoke test: inbound msg appears once in `/chat`; outbound text in-window sends; outside-24h requires template.

## Verification checklist

- [ ] `meta-webhook` GET verify returns the challenge (Meta dashboard shows webhook Verified).
- [ ] Test inbound WhatsApp msg → lands once in `whatsapp_messages` → visible in `/chat`.
- [ ] Outbound text within 24h window → delivered (real wamid in `SendResult.message_id`).
- [ ] Outbound outside 24h → `MetaWindowClosedError` / template required (not a silent fail).
- [ ] Mixed-provider org: a Uazapi lead still replies free-form (no mis-route to Meta 24h gate) — Rule 1/R7.
