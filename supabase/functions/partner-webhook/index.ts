import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { validateApiKey, checkRateLimit, getClientIdentifier } from "../_shared/auth.ts";

function logUsage(
  supabase: any,
  keyId: string,
  orgId: string,
  statusCode: number,
  responseTimeMs: number,
  ipAddress: string | null,
) {
  supabase
    .from("api_key_usage_log")
    .insert({
      key_id: keyId,
      organization_id: orgId,
      endpoint: "partner-webhook",
      method: "POST",
      status_code: statusCode,
      response_time_ms: responseTimeMs,
      ip_address: ipAddress,
    })
    .then(() => {})
    .catch((err: unknown) => console.error("[partner-webhook] usage log error:", err));
}

Deno.serve(withErrorBoundary('partner-webhook', async (req) => {
  const startTime = performance.now();
  const origin = req.headers.get("Origin") ?? undefined;
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // --- Validate API key ---
  const auth = await validateApiKey(supabase, req);
  if (auth.subscriptionBlocked) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 402,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!auth.organizationId) {
    return new Response(JSON.stringify({ error: "API key sem organização vinculada" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ipAddress = getClientIdentifier(req);

  // --- Scope check ---
  const scopes = auth.scopes ?? [];
  const hasWriteScope = scopes.includes("lead:write") || scopes.includes("*");
  if (!hasWriteScope) {
    if (auth.keyId && auth.organizationId) {
      logUsage(supabase, auth.keyId, auth.organizationId, 403, Math.round(performance.now() - startTime), ipAddress);
    }
    return new Response(JSON.stringify({ error: "API key sem permissão lead:write" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- Rate limit ---
  const clientId = auth.keyId ?? getClientIdentifier(req);
  const limit = auth.rateLimitPerMinute ?? 60;
  const rateLimited = checkRateLimit(clientId, limit, 60_000);
  if (!rateLimited.allowed) {
    return new Response(JSON.stringify({ error: "Rate limit excedido. Tente novamente em breve." }), {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil(rateLimited.resetIn / 1000)),
      },
    });
  }

  // --- Parse body ---
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Body JSON inválido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.name || typeof body.name !== "string") {
    return new Response(JSON.stringify({ error: "Campo 'name' é obrigatório" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- Build lead-webhook payload ---
  const leadPayload: Record<string, unknown> = {
    source: body.source ?? "partner_api",
    organization_id: auth.organizationId,
    fields: {
      name: body.name,
      ...(body.phone && { phone: body.phone }),
      ...(body.email && { email: body.email }),
      ...(body.company && { company: body.company }),
      ...(body.notes && { notes: body.notes }),
      ...(body.segment && { segment: body.segment }),
      ...(body.faturamento && { faturamento: body.faturamento }),
      ...(body.urgency && { urgency: body.urgency }),
      ...(body.rating && { rating: body.rating }),
      ...(body.utm_source && { utm_source: body.utm_source }),
      ...(body.utm_medium && { utm_medium: body.utm_medium }),
      ...(body.utm_campaign && { utm_campaign: body.utm_campaign }),
      ...(body.utm_content && { utm_content: body.utm_content }),
      ...(body.utm_term && { utm_term: body.utm_term }),
    },
    update_existing_if_match: body.update_existing ?? true,
  };

  if (body.tags) leadPayload.tags = body.tags;
  if (body.custom_fields) leadPayload.custom_fields = body.custom_fields;
  if (body.assigned_user_id) leadPayload.assigned_user_id = body.assigned_user_id;

  // Tag-driven routing: quando o caller manda tags geridas pela plataforma (prefixo `sys:`),
  // a posição do lead no funil é decidida pelos workflows nativos tag→stage do Torque.
  // Ignoramos qualquer pipe/stage do caller nesse caso — ex.: a plataforma DNA/Zuvic roteia
  // checkout.success → confirmacao/ganho, um stage que pode não existir na org ou pertencer
  // ao funil errado (reunião), o que jogaria um assinante pago em lembretes de reunião.
  // A própria tag `sys:*` posiciona o lead via workflow.
  const incomingTags = Array.isArray(body.tags)
    ? body.tags
    : typeof body.tags === "string"
      ? [body.tags]
      : [];
  const hasPlatformTag = incomingTags.some(
    (t) => typeof t === "string" && t.trim().toLowerCase().startsWith("sys:"),
  );

  // SCRUM-624 (D6): `body.pipe` é a config de destino desta porta e passa
  // ADIANTE como veio — id (uuid) ou slug de QUALQUER funil da org, aliases
  // legados inclusos. Quem resolve (e erra 4xx em funil inexistente, ANTES de
  // criar o lead) é o lead-webhook via pipeline-adapter; o 4xx dele repassa ao
  // caller pelo proxy de status abaixo. Os defaults "whatsapp"/"novo" são o
  // comportamento histórico desta porta: slug de funil semeado + etapa
  // remapeada pelo ghost-stage guard do lead-webhook se "novo" estiver inativa.
  if ((body.pipe || body.stage) && !hasPlatformTag) {
    leadPayload.place_in_pipe = {
      pipe: body.pipe ?? "whatsapp",
      stage: body.stage ?? "novo",
      ...(body.meeting_date && { meeting_date: body.meeting_date }),
    };
  }

  // --- Forward to lead-webhook ---
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const webhookKey = Deno.env.get("WEBHOOK_API_KEY")!;

  const leadResponse = await fetch(`${supabaseUrl}/functions/v1/lead-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-key": webhookKey,
    },
    body: JSON.stringify(leadPayload),
  });

  const leadResult = await leadResponse.json().catch(() => null);

  const elapsed = Math.round(performance.now() - startTime);

  if (!leadResponse.ok) {
    console.error("[partner-webhook] lead-webhook error:", leadResponse.status, leadResult);
    const statusCode = leadResponse.status >= 500 ? 502 : leadResponse.status;
    if (auth.keyId && auth.organizationId) {
      logUsage(supabase, auth.keyId, auth.organizationId, statusCode, elapsed, ipAddress);
    }
    return new Response(JSON.stringify({
      error: "Erro ao processar lead",
      details: leadResult?.error ?? leadResult?.message ?? "Erro interno",
    }), {
      status: statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (auth.keyId && auth.organizationId) {
    logUsage(supabase, auth.keyId, auth.organizationId, 200, elapsed, ipAddress);
  }

  return new Response(JSON.stringify({
    success: true,
    lead_id: leadResult?.lead_id ?? leadResult?.id ?? null,
    message: leadResult?.message ?? "Lead criado com sucesso",
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));
