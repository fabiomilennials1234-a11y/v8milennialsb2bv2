/**
 * support-notify-staff — avisa o suporte da Torque, no grupo de WhatsApp
 * dedicado, quando um Chamado é aberto (ADR-0018, #1030).
 *
 * Disparado por: trigger pg_net no INSERT de `support_tickets`.
 * Auth: x-cron-secret.
 *
 * A mensagem traz Organização, Impacto, tipo, título e um deep-link pro console
 * master — o suficiente pra alguém decidir se larga o que está fazendo.
 *
 * Envia pela instância da plataforma (`SUPPORT_UAZAPI_TOKEN`), para o grupo
 * (`SUPPORT_WHATSAPP_GROUP_JID`), via `UAZAPI_BASE_URL`. Nunca pela instância
 * comercial: essas são secrets dedicadas, distintas das credenciais de vendas.
 *
 * Best-effort por design: o Chamado já está gravado quando este endpoint roda
 * (o trigger é AFTER INSERT, desacoplado por pg_net). Falha de entrega nunca
 * derruba a criação — é registrada em `runtime_logs` e o loop segue pelo badge
 * in-app, que é o canal primário.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { buildStaffMessage } from "./message.ts";

Deno.serve(
  withErrorBoundary("support-notify-staff", async (req: Request): Promise<Response> => {
    const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // --- Auth: x-cron-secret ---
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!cronSecret) {
      console.error("[support-notify-staff] CRON_SECRET não configurado — negando tudo");
      return json({ error: "Server misconfiguration" }, 500);
    }
    const headerSecret = req.headers.get("x-cron-secret");
    if (!headerSecret || !timingSafeCompare(headerSecret, cronSecret)) {
      return json({ error: "Unauthorized" }, 401);
    }

    // --- Payload ---
    let ticketId: string;
    try {
      const body = await req.json();
      ticketId = String(body?.ticket_id ?? "");
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (!ticketId) return json({ error: "ticket_id required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server misconfiguration" }, 500);
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // --- Carrega o Chamado + nome da Organização (service role, ignora RLS) ---
    const { data: ticket, error: ticketErr } = await supabase
      .from("support_tickets")
      .select("id, title, tipo, impacto, severidade, organization_id")
      .eq("id", ticketId)
      .single();

    if (ticketErr || !ticket) {
      await logRuntime({
        module: "support",
        action: "notify_staff",
        status: "error",
        entityType: "support_ticket",
        entityId: ticketId,
        errorMessage: ticketErr?.message ?? "ticket não encontrado",
      });
      return json({ error: "ticket not found" }, 404);
    }

    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", ticket.organization_id)
      .single();
    const orgName = org?.name ?? "Organização";

    // --- Secrets do canal de suporte (dedicadas, jamais as de vendas) ---
    const token = Deno.env.get("SUPPORT_UAZAPI_TOKEN");
    const groupJid = Deno.env.get("SUPPORT_WHATSAPP_GROUP_JID");
    const baseUrl = Deno.env.get("UAZAPI_BASE_URL");
    if (!token || !groupJid || !baseUrl) {
      await logRuntime({
        organizationId: ticket.organization_id,
        module: "support",
        action: "notify_staff",
        status: "skipped",
        entityType: "support_ticket",
        entityId: ticketId,
        errorMessage: "secrets do canal de suporte ausentes (SUPPORT_UAZAPI_TOKEN/SUPPORT_WHATSAPP_GROUP_JID/UAZAPI_BASE_URL)",
      });
      return json({ ok: false, skipped: "missing_support_secrets" });
    }

    const text = buildStaffMessage(ticket, orgName);

    // --- Envia. Best-effort: falha aqui não pode virar 5xx que o trigger repita. ---
    try {
      const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/send/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token },
        body: JSON.stringify({ number: groupJid, text }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        await logRuntime({
          organizationId: ticket.organization_id,
          module: "support",
          action: "notify_staff",
          status: "error",
          entityType: "support_ticket",
          entityId: ticketId,
          errorMessage: `uazapi ${resp.status}: ${detail.slice(0, 200)}`,
        });
        return json({ ok: false, uazapi_status: resp.status });
      }

      await logRuntime({
        organizationId: ticket.organization_id,
        module: "support",
        action: "notify_staff",
        status: "success",
        entityType: "support_ticket",
        entityId: ticketId,
      });
      return json({ ok: true });
    } catch (err) {
      await logRuntime({
        organizationId: ticket.organization_id,
        module: "support",
        action: "notify_staff",
        status: "error",
        entityType: "support_ticket",
        entityId: ticketId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return json({ ok: false, error: "send_failed" });
    }
  })
);
