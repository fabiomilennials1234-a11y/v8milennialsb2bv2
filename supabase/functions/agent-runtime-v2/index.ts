/**
 * agent-runtime-v2 — Copilot v2 clean-slate runtime entry (Slice 1).
 *
 * Layered harness: border → queue → cognition → guardrails → outbound →
 * observability → scheduler. This entry is the BORDER + ack only. Cognition runs
 * off the queue (Slice 2), never inline — the provider gets a fast ack.
 *
 * Auth: the instance/secret resolves organization_id (trusted). The inbound
 * payload's org field, if present, is IGNORED — a provider can forge it.
 *
 * Pattern: Deno.serve(withSentry(...)) + withSecurityHeaders(getCorsHeaders) +
 * OPTIONS early return. config.toml: verify_jwt = false (custom auth).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { processInbound, type BorderContext } from "../_shared/copilot-v2/border.ts";

serve(
  withSentry("agent-runtime-v2", async (req: Request) => {
    const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return json({ ack: "error", reason: "invalid_schema" }, 200);
    }

    // ── Resolve org from the trusted instance/secret — NEVER from payload ──
    const instanceToken: string | undefined =
      payload?.token ?? payload?.instance ?? payload?.instanceName ?? req.headers.get("x-instance-token") ?? undefined;
    if (!instanceToken) return json({ ack: "error", reason: "no_instance" }, 200);

    const { data: instance } = await supabase
      .from("whatsapp_instances")
      .select("organization_id")
      .or(`instance_name.eq.${instanceToken},token.eq.${instanceToken}`)
      .maybeSingle();
    if (!instance?.organization_id) return json({ ack: "error", reason: "unknown_instance" }, 200);

    // ── Extract message fields from the Uazapi messages event ──
    const msg = payload?.message ?? payload?.data ?? payload;
    const rawPhone: string | null =
      msg?.sender ?? msg?.phone ?? (typeof msg?.chatid === "string" ? msg.chatid.split("@")[0] : null);
    const content: string =
      msg?.text ?? msg?.content ?? msg?.body ?? msg?.caption ?? "";
    const isGroup: boolean | null =
      typeof msg?.isGroup === "boolean" ? msg.isGroup
      : typeof msg?.chatid === "string" ? msg.chatid.includes("@g.us")
      : null;

    const ctx: BorderContext = {
      organizationId: instance.organization_id,
      rawPhone,
      content,
      messageType: msg?.messageType ?? msg?.type ?? "text",
      source: "inbound",
      isGroup,
    };

    const ack = await processInbound(supabase, ctx);
    return json(ack, 200);
  }),
);
