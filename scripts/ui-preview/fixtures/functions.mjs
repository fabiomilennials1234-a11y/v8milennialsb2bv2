/**
 * Edge function fixtures (`/functions/v1/<name>`). Anything not listed answers
 * `{}` with 200 — enough for fire-and-forget calls.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Every permission key the app knows about, all granted (admin preview). */
function allPermissionKeys() {
  const keys = new Set();
  for (const f of ["src/modules/identity/lib/permissions.ts", "src/shared/permission-actions.ts"]) {
    try {
      const text = readFileSync(resolve(ROOT, f), "utf8");
      for (const m of text.matchAll(/["'`]([a-z_]+\.[a-z_]+)["'`]/g)) keys.add(m[1]);
    } catch {
      /* file moved — the admin bypass still opens every gate */
    }
  }
  return Object.fromEntries([...keys].map((k) => [k, true]));
}
const PERMS = allPermissionKeys();

export const functionHandlers = {
  "get-member-permissions": (_body, fx) => ({
    features: PERMS,
    isAdmin: true,
    jobTitle: fx.db.team_members[0].job_title,
    metricType: "sales",
  }),
  "attach-to-org-by-pending-invite": () => ({ attached: false }),
  // Envelope: { ok, result } (src/modules/communication/lib/whatsappApi.ts)
  "whatsapp-api-proxy": (body) => {
    const action = body?.action ?? "";
    if (action === "getMessageLimits") return { ok: true, result: { current: null, limit: null, can_send_new_messages: true } };
    if (/status|connection|state/i.test(action)) return { ok: true, result: { status: "connected", state: "open", connected: true, loggedIn: true } };
    return { ok: true, result: {} };
  },
  "oraculo-briefing": (_body, fx) => ({
    briefing: {
      id: "0f0f0f0f-0000-4000-8000-00000000b001",
      headline: "3 propostas acima de R$ 100 mil estão paradas há mais de 4 dias no Funil de Vendas.",
      status: "new",
      expires_at: new Date(fx.NOW + 8 * 3600e3).toISOString(),
      local_date: new Date(fx.NOW).toISOString().slice(0, 10),
      bottleneck: { stage: "proposta_enviada", count: 3 },
      conversation_id: null,
    },
  }),
};
