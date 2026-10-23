import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createMetaPrivacyHandler, type PrivacyKind } from "./meta-privacy-handler.ts";
import { withSecurityHeaders } from "./security-headers.ts";

export function metaPrivacyEndpoint(kind: PrivacyKind) {
  return async (req: Request): Promise<Response> => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    // Dedicated app credentials: never replace legacy Meta/WhatsApp app secrets.
    const secret = Deno.env.get("META_CRM_APP_SECRET") ?? "";
    const appId = Deno.env.get("META_CRM_APP_ID") ?? "";
    if (!supabaseUrl || !serviceKey || !secret || !appId) {
      return new Response(JSON.stringify({ error: "not_configured" }), { status: 503, headers: withSecurityHeaders({ "Cache-Control": "no-store" }) });
    }
    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const handler = createMetaPrivacyHandler({
      kind, appId, secret, callbackUrl: `${supabaseUrl}/functions/v1/meta-data-deletion`,
      store: {
        async enqueue(input) {
          const { error } = await client.from("meta_privacy_requests").upsert(input, { onConflict: "confirmation_code", ignoreDuplicates: true });
          if (error) throw new Error("privacy_storage_failed");
        },
        async status(code, app) {
          const { data, error } = await client.from("meta_privacy_requests").select("status").eq("confirmation_code", code).eq("app_id", app).eq("kind", "deletion").maybeSingle();
          if (error) throw new Error("privacy_storage_failed");
          return data?.status ?? null;
        },
      },
    });
    const result = await handler(req);
    return new Response(result.body, { status: result.status, headers: withSecurityHeaders(Object.fromEntries(result.headers)) });
  };
}
