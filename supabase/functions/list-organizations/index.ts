import { withSentry } from '../_shared/sentry.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";

Deno.serve(withSentry('list-organizations', async (req) => {
  const origin = req.headers.get("Origin") ?? undefined;
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const webhookKey = req.headers.get("x-webhook-key") ?? "";
  const expectedKey = Deno.env.get("WEBHOOK_API_KEY") ?? "";

  if (!webhookKey || !expectedKey || !timingSafeCompare(webhookKey, expectedKey)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);
  const type = url.searchParams.get("type");

  if (type === "stages") {
    const orgId = url.searchParams.get("organization_id");
    if (!orgId) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const pipe = url.searchParams.get("pipe");
    let query = supabase
      .from("pipeline_stages")
      .select("stage_key, name, pipeline_type")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("pipeline_type")
      .order("position");
    if (pipe) {
      query = query.eq("pipeline_type", pipe);
    }
    const { data: stages, error: stErr } = await query;
    if (stErr) {
      return new Response(JSON.stringify({ error: stErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const pipeLabels: Record<string, string> = {
      whatsapp: "WhatsApp", confirmacao: "Confirmação", propostas: "Propostas",
      upsell_base: "Upsell Base", upsell_gestao: "Upsell Gestão",
    };
    const mapped = (stages ?? []).map((s) => ({
      label: pipe ? s.name : `${pipeLabels[s.pipeline_type] ?? s.pipeline_type} › ${s.name}`,
      value: pipe ? s.stage_key : `${s.pipeline_type}:${s.stage_key}`,
    }));
    return new Response(JSON.stringify(mapped), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name")
    .not("name", "ilike", "%test%")
    .not("name", "ilike", "%integration%")
    .order("name");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const mapped = (data ?? []).map((o) => ({ label: o.name, value: o.id }));

  return new Response(JSON.stringify(mapped), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));
