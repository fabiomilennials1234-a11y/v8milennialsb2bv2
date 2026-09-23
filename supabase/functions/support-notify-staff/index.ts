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
 * Envia pela instância CONECTADA da organização da plataforma — resolvida do
 * banco a cada disparo por `_shared/support-channel.ts` — para o grupo
 * (`SUPPORT_WHATSAPP_GROUP_JID`), via `UAZAPI_BASE_URL`.
 *
 * A credencial deixou de ser uma secret copiada à mão porque a secret já morreu
 * duas vezes em silêncio: token revogado em 14/07/2026 (24 dias, 37 avisos
 * perdidos) e sessão irrecuperável em 02/09/2026, quando o número reconectou sob
 * outra instância da Uazapi. O banco sabe qual instância está de pé; a secret,
 * não. Ver o cabeçalho de `support-channel.ts`.
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
import {
  resolveSupportSender,
  sendSupportText,
  senderTrace,
} from "../_shared/support-channel.ts";

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

    // --- Quem manda: instância conectada da org da plataforma, do banco ---
    const resolved = await resolveSupportSender(supabase, (k) => Deno.env.get(k));
    if (!resolved.ok) {
      await logRuntime({
        organizationId: ticket.organization_id,
        module: "support",
        action: "notify_staff",
        status: "skipped",
        entityType: "support_ticket",
        entityId: ticketId,
        errorMessage: `canal de suporte sem remetente: ${resolved.reason}`,
      });
      return json({ ok: false, skipped: "no_support_sender" });
    }
    const sender = resolved.sender;

    const text = buildStaffMessage(ticket, orgName);

    // --- Envia. Best-effort: falha aqui não pode virar 5xx que o trigger repita. ---
    // O rastro do remetente entra nos DOIS caminhos: sem ele, "falhou" não
    // distingue instância morta de canal apontado para o lugar errado, que foi
    // exatamente a ambiguidade que custou 24 dias em julho.
    const envio = await sendSupportText(sender, text);

    await logRuntime({
      organizationId: ticket.organization_id,
      module: "support",
      action: "notify_staff",
      status: envio.ok ? "success" : "error",
      entityType: "support_ticket",
      entityId: ticketId,
      errorMessage: envio.ok ? undefined : (envio.detail ?? "envio falhou"),
      payloadSnapshot: senderTrace(sender),
    });

    return json(envio.ok ? { ok: true } : { ok: false, error: "send_failed" });
  })
);
